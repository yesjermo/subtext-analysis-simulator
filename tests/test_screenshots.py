"""The screenshot reader's layout rules, on lines as an OCR engine returns them, and on test screenshots.

  python3 -m unittest discover tests
"""
import json
import shutil
import subprocess
import sys
from difflib import SequenceMatcher
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from subtext.screenshots import available_engines, bubbles_from_page, ocr_vision  # noqa: E402

SHOTS = ROOT / "tests" / "fixtures" / "shots"
PAGES = json.loads((ROOT / "tests" / "fixtures" / "pages.json").read_text(encoding="utf-8"))
EXPECTED = [(m["side"], m["text"]) for m in json.loads((SHOTS / "expected.json").read_text())["convo"]]


class LayoutRules(unittest.TestCase):
    """Each page is the lines Apple Vision read from that app's test screenshot (and a few OCR slips)."""

    def check(self, name):
        got = [(b["side"], b["text"]) for b in bubbles_from_page(PAGES[name])]
        self.assertEqual(got, EXPECTED, name)

    def test_whatsapp_times_and_ticks_inside_bubbles(self):
        self.check("whatsapp")

    def test_whatsapp_times_misread(self):
        self.check("whatsapp-misread")

    def test_snapchat_name_labels(self):
        self.check("snapchat")

    def test_discord_name_and_time_headers(self):
        self.check("discord")

    def test_discord_name_and_time_read_apart(self):
        self.check("discord-split")

    def test_discord_names_without_times(self):
        self.check("discord-names-only")

    def test_whatsapp_time_a_little_below(self):
        self.check("whatsapp-tesseract")

    def test_bubble_apps_unchanged(self):
        self.check("instagram")

    def test_one_sided_chat_with_repeats_stays_bubbles(self):
        line = lambda text, x0, x1, y: {"text": text, "x0": x0, "x1": x1, "y0": y, "y1": y + 0.02}
        page = {"lines": [line("lol", 0.05, 0.14, 0.20), line("wait what", 0.05, 0.30, 0.24),
                          line("lol", 0.05, 0.14, 0.28), line("ok fine", 0.05, 0.25, 0.32)]}
        self.assertEqual([b["text"] for b in bubbles_from_page(page)], ["lol", "wait what", "lol", "ok fine"])

    def test_a_time_in_a_message_stays(self):
        page = {"lines": [
            {"text": "what time tmrw?", "x0": 0.05, "x1": 0.40, "y0": 0.20, "y1": 0.22},
            {"text": "meet at 9:30 pm", "x0": 0.55, "x1": 0.95, "y0": 0.25, "y1": 0.27},
        ]}
        self.assertEqual([b["text"] for b in bubbles_from_page(page)], ["what time tmrw?", "meet at 9:30 pm"])


class BrowserRulesAgree(unittest.TestCase):
    """web/screenshots.js gives the same answers as the Python rules on every recorded page."""

    def test_js(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        res = subprocess.run([node, str(ROOT / "tests" / "parity" / "screenshots_js.js")], capture_output=True, text=True, check=True)
        self.assertIn("identical", res.stdout, res.stdout)


@unittest.skipUnless(available_engines() and "vision" in available_engines(), "needs Apple Vision (a Mac)")
class RealScreenshots(unittest.TestCase):
    def test_every_app_layout(self):
        # OCR slips a letter now and then ("hili", "pertect"): the words must be close, the sides exact.
        for img in sorted(SHOTS.glob("*.png")):
            got = bubbles_from_page(ocr_vision([img])[0])
            self.assertEqual([b["side"] for b in got], [s for s, _ in EXPECTED], img.stem)
            for b, (_, want) in zip(got, EXPECTED):
                self.assertGreaterEqual(SequenceMatcher(None, b["text"].lower(), want).ratio(), 0.85, f"{img.stem}: {b['text']!r}")


if __name__ == "__main__":
    unittest.main()
