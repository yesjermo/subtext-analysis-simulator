"""Run with:  python3 -m unittest discover tests"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from subtext import decoder as td  # noqa: E402
from subtext.chat_parser import Message, parse_file  # noqa: E402


class DecoderTests(unittest.TestCase):
    def test_labelled_examples(self):
        for name, floor in (("labelled", 0.95), ("holdout", 0.85)):
            path = ROOT / "subtext" / "data" / f"{name}.jsonl"
            rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
            hits = sum(td.decode_message(r["text"])["category"] == r["expect"] for r in rows)
            self.assertGreaterEqual(hits / len(rows), floor, f"{name}: {hits}/{len(rows)}")

    def test_slang_longest_match(self):
        self.assertEqual([h["term"] for h in td.find_slang("no cap that was bussin fr")], ["no cap", "bussin", "fr"])

    def test_emoji_gen_z_meaning(self):
        meanings = {e["emoji"]: e["meaning"] for e in td.find_emoji("lmaooo 😭💀")}
        self.assertIn("laughing", meanings["😭"])

    def test_interest_moves_the_right_way(self):
        self.assertGreater(td.decode_message("i lowkey deleted my hinge")["interest"]["score"], 65)
        self.assertLess(td.decode_message("k.")["interest"]["score"], 40)

    def test_effort_and_delay_raise_ghost_risk(self):
        long_text = "omg today was so chaotic, my professor cancelled the exam five minutes before it started and i was so mad"
        base = td.decode_message("lol")["ghost_risk"]["score"]
        worse = td.decode_message("lol", your_last=long_text, delay_min=26 * 60)["ghost_risk"]["score"]
        self.assertGreater(worse, base)

    def test_curly_quotes(self):
        self.assertEqual(td.decode_message("I’m not really interested in talking to anyone else")["category"], "dtr")

    def test_red_flags_and_boundaries(self):
        r = td.decode_message("dont be boring just send a pic")
        self.assertEqual(r["category"], "red_flag_pressure")
        self.assertIn("Pressure / guilt", r["flags"]["red"])
        self.assertEqual(td.decode_message("can we take it slow")["category"], "boundary")

    def test_every_category_has_replies(self):
        for key in td.ORDER:
            cat = td.CATS[key]
            self.assertTrue(all(cat["replies"].get(s) for s in ("match", "playful", "sincere")), key)
            self.assertTrue(cat["avoid"], key)

    def test_patterns_are_portable(self):
        for s in td.SIGNALS:  # web/engine.js runs the same patterns: no Python-only syntax
            self.assertNotRegex(s["pattern"], r"\(\?P<|\(\?<!|\(\?#|\\A|\\Z", s["id"])

    def test_demo_chats(self):
        good = td.decode_chat(parse_file(ROOT / "examples" / "maya.txt"), "Maya", "Me")["overview"]
        fading = td.decode_chat(parse_file(ROOT / "examples" / "jay.txt"), "Jay", "Me")["overview"]
        self.assertEqual(good["stage"]["key"], "dtr")
        self.assertEqual(good["ghost_risk"]["level"], "low")
        self.assertEqual(fading["stage"]["key"], "fading")
        self.assertEqual(fading["ghost_risk"]["level"], "high")

    def test_fading_chat(self):
        msgs = [Message("Me", "omg how was the concert?? i've been dying to hear about it, did they play the new album"),
                Message("Them", "good"), Message("Me", "wait what was the best song"), Message("Them", "idk"),
                Message("Me", "haha ok wanna get food this week?"), Message("Them", "maybe another time"),
                Message("Me", "all good"), Message("Them", "k")]
        o = td.decode_chat(msgs, "Them", "Me")["overview"]
        self.assertEqual(o["stage"]["key"], "fading")


class ParityTest(unittest.TestCase):
    """web/engine.js must read every text and chat exactly like subtext/decoder.py."""

    def test_python_and_js_agree(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "parity.json"
            subprocess.run([sys.executable, str(ROOT / "tests" / "parity" / "dump_python.py"), str(out)], check=True)
            res = subprocess.run([node, str(ROOT / "tests" / "parity" / "compare_js.js"), str(out)],
                                 capture_output=True, text=True, check=True)
        self.assertIn("identical", res.stdout, res.stdout)


if __name__ == "__main__":
    unittest.main()
