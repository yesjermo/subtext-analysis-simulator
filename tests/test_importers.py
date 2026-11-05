"""Importers: app exports, iMessage's database and screenshots.  python3 -m unittest discover tests"""
import csv
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import get_chat  # noqa: E402
from subtext.chat_parser import Message  # noqa: E402
from subtext.importers import fix_mojibake, read_export, read_exports, read_text_export, xml_unescape  # noqa: E402
from subtext.screenshots import available_engines, bubbles_from_page, clean_ocr, is_junk, parse_screenshots, stitch  # noqa: E402

EXPORTS = ROOT / "examples" / "exports"
FIXTURES = ROOT / "tests" / "fixtures"


def texts(conv):
    return [(m.sender, m.text) for m in conv.messages]


class ExportTests(unittest.TestCase):
    def test_instagram(self):
        [c] = read_export(EXPORTS / "instagram" / "message_1.json")
        self.assertEqual((c.source, c.title, c.them, c.me), ("instagram", "Sam Chen", "Sam Chen", "Riley Park"))
        self.assertEqual(c.messages[0].text, "omg ur story from the concert 😭")  # mojibake fixed, oldest first
        self.assertIn(("Sam Chen", "https://www.instagram.com/reel/C9xYz12AbCd/"), texts(c))  # a shared reel is its link
        joined = " ".join(m.text for m in c.messages)
        self.assertNotIn("Liked a message", joined)   # reactions and attachments aren't words anyone typed
        self.assertNotIn("sent an attachment", joined)
        self.assertEqual([m.timestamp for m in c.messages], sorted(m.timestamp for m in c.messages))

    def test_mojibake_leaves_good_text_alone(self):
        self.assertEqual(fix_mojibake("ð\x9f\x98\xad"), "😭")
        self.assertEqual(fix_mojibake("already fine 😭"), "already fine 😭")
        self.assertEqual(fix_mojibake("café"), "café")

    def test_tiktok_lists_every_thread(self):
        convs = read_export(EXPORTS / "tiktok" / "user_data_tiktok.json")
        self.assertEqual([c.title for c in convs], ["jaylen.wav", "mia.lol"])
        self.assertEqual((convs[0].them, convs[0].me), ("jaylen.wav", "riley.prk"))
        self.assertEqual(convs[0].messages[0].text, "heyyy")

    def test_snapchat_both_layouts_merge(self):
        new = read_export(EXPORTS / "snapchat" / "chat_history.json")
        self.assertEqual(texts(new[0])[:2], [("alexrivera", "u up?"), ("Me", "yeah wyd")])
        self.assertNotIn("", [m.text for m in new[0].messages])  # the photo snap is skipped
        [both] = read_exports([EXPORTS / "snapchat"])
        self.assertEqual(len(both.messages), 8)
        self.assertEqual(both.messages[0].text, "hey stranger")  # the 2021 file's chat comes first

    def test_sms_backup(self):
        convs = {c.title: c for c in read_export(EXPORTS / "sms" / "sms-backup.xml")}
        self.assertEqual(set(convs), {"Jordan", "Mom"})
        j = texts(convs["Jordan"])
        self.assertIn(("Jordan", "lmk 🙂"), j)                                   # MMS text part, emoji from number codes
        self.assertIn(("Jordan", "that thai place on 5th? & then a movie"), j)  # &amp; unescaped
        self.assertEqual(j[1], ("Me", "yes!! what were u thinking"))           # type 2 = sent

    def test_xml_unescape(self):
        self.assertEqual(xml_unescape("a &amp; b &#55357;&#56898; &#x1F480;"), "a & b 🙂 💀")

    def test_whatsapp_and_plain_text_still_work(self):
        [c] = read_export(ROOT / "examples" / "jay.txt")
        self.assertEqual((c.source, c.them, c.me), ("whatsapp", "Jay", "Me"))
        [w] = read_text_export("WhatsApp Chat with Jay.txt", "[4/1/26, 8:02:10 PM] Jay: heyyy\n[4/1/26, 8:05:40 PM] Riley: hiii\n")
        self.assertEqual((w.title, w.them, w.me), ("Jay", "Jay", "Riley"))

    def test_bad_json_says_so(self):
        with self.assertRaises(ValueError):
            read_text_export("message_1.json", '{"participants": [')

    def test_export_command_writes_csv_with_times(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "jaylen.csv"
            with redirect_stdout(io.StringIO()):
                get_chat.main(["export", str(EXPORTS / "tiktok"), "--chat", "jaylen", "--out", str(out)])
            with out.open(encoding="utf-8") as fh:
                rows = list(csv.DictReader(fh))
        self.assertEqual(rows[0], {"sender": "jaylen.wav", "text": "heyyy", "timestamp": "2026-04-02T19:30:00"})


class IMessageTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(FIXTURES))
        from make_chat_db import build
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "chat.db"
        build(str(self.db))

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_a_chat(self):
        from subtext.imessage import MessagesDB
        with MessagesDB(self.db) as db:
            chats = db.list_chats()
            self.assertEqual([c["handles"] for c in chats], [["+15551230001"], ["mia@example.com"]])
            conv = db.read_chat(db.find_chat("555 123 0001")["id"], them="Jordan")
        self.assertEqual(texts(conv), [
            ("Jordan", "are u free friday?"),
            ("Me", "yes!! what were u thinking 😭"),  # only in attributedBody (macOS Ventura and later)
            ("Jordan", "that thai place on 5th?"),     # the photo before it and the "Loved" tapback after are skipped
            ("Me", "perfect, see u there"),
        ])
        self.assertTrue(all(m.timestamp.startswith("2026-04-0") for m in conv.messages))

    def test_never_touches_the_original(self):
        from subtext.imessage import MessagesDB
        before = self.db.read_bytes()
        with MessagesDB(self.db) as db:
            db.list_chats()
        self.assertEqual(self.db.read_bytes(), before)

    def test_unknown_chat(self):
        from subtext.imessage import MessagesDB
        with MessagesDB(self.db) as db, self.assertRaises(ValueError):
            db.find_chat("nobody")


def line(text, x0, x1, y0, h=0.02):
    return {"text": text, "x0": x0, "x1": x1, "y0": y0, "y1": y0 + h}


class ScreenshotTests(unittest.TestCase):
    def test_sides_and_chrome(self):
        page = {"lines": [
            line("9:41", 0.08, 0.15, 0.02),                 # status bar
            line("sam.k", 0.2, 0.3, 0.06),                  # header
            line("Today 8:02 PM", 0.36, 0.55, 0.15),        # centred divider
            line("hey how was your day", 0.55, 0.92, 0.20), # right = me
            line("hiii it was good!!", 0.16, 0.62, 0.25),   # left = them
            line("pretty chill, kinda tired", 0.40, 0.92, 0.32),
            line("honestly", 0.40, 0.60, 0.348),            # wrapped line of the same bubble
            line("Seen", 0.82, 0.92, 0.40),
            line("Message...", 0.1, 0.27, 0.93),            # typing bar
        ]}
        self.assertEqual(bubbles_from_page(page), [
            {"side": "right", "text": "hey how was your day"},
            {"side": "left", "text": "hiii it was good!!"},
            {"side": "right", "text": "pretty chill, kinda tired honestly"},
        ])

    def test_junk_and_cleanup(self):
        for junk in ["Seen", "Active now", "Today 8:02 PM", "Mon 9:12 AM", "Liked a message", "Message..."]:
            self.assertTrue(is_junk(junk), junk)
        for keep in ["k", "ok", "sent it!", "lol", "see you at 9"]:
            self.assertFalse(is_junk(keep), keep)
        self.assertEqual(clean_ocr("work was a lot and | need sleep ®"), "work was a lot and I need sleep")

    def test_stitch_overlap_with_ocr_noise(self):
        a = [Message("Me", "hey"), Message("Them", "omg yes"), Message("Them", "7?"), Message("Me", "ya")]
        again = [Message("Them", "omg yes"), Message("Them", "77?"), Message("Me", "ya")]
        self.assertEqual(len(stitch(a, again)), 4)
        self.assertEqual(len(stitch(a, again[2:] + [Message("Them", "night")])), 5)

    @unittest.skipUnless(available_engines(), "no OCR engine (Apple Vision on a Mac, or tesseract)")
    def test_real_screenshots_light_and_dark(self):
        for name in ("chat-light.png", "chat-dark.png"):
            msgs, _ = parse_screenshots([FIXTURES / name], them="Alex")
            self.assertEqual([m.sender for m in msgs], ["Alex", "Alex", "Me", "Alex", "Me", "Alex"], name)
            self.assertEqual(msgs[3].text, "good!! wanna get coffee this week?", name)  # a two-line bubble, joined
            self.assertEqual(msgs[4].text, "yes! saturday?", name)                     # white on blue


class ImporterParityTest(unittest.TestCase):
    """web/importers.js must read every sample export exactly like subtext/importers.py."""

    def test_python_and_js_agree(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "imports.json"
            subprocess.run([sys.executable, str(ROOT / "tests" / "parity" / "importers_python.py"), str(out)], check=True)
            res = subprocess.run([node, str(ROOT / "tests" / "parity" / "importers_js.js"), str(out)],
                                 capture_output=True, text=True, check=True)
        self.assertIn("identical", res.stdout, res.stdout)


if __name__ == "__main__":
    unittest.main()
