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
            styles = ("match", "sincere") if cat.get("safety") else ("match", "playful", "sincere")
            self.assertTrue(all(cat["replies"].get(s) for s in styles), key)
            if cat.get("safety"):
                self.assertNotIn("playful", cat["replies"], key)  # no jokes when someone is abusive or threatening
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


class WordsBeforeEmoji(unittest.TestCase):
    """The words decide the reading. Emoji fill in when the words say nothing, and a string of random
    emoji is decoration, not meaning."""

    def read(self, text):
        return td.decode_message(text)

    def test_random_emoji_dont_change_a_dry_reply(self):
        r = self.read("k 😭💀🔥🥵")
        self.assertEqual(r["category"], "dry")
        self.assertEqual(r["tone"]["primary"], "dry")
        self.assertLess(r["interest"]["score"], 45)
        self.assertNotEqual(r["stage"]["key"], "second_base")
        self.assertIn("random_emoji", [t["key"] for t in r["typing"]])

    def test_one_random_physical_emoji_doesnt_set_the_stage(self):
        r = self.read("ok 🍆😂🌽🦒")
        self.assertEqual(r["category"], "dry")
        self.assertNotEqual(r["stage"]["key"], "second_base")

    def test_words_still_match_with_emoji_after_them(self):
        self.assertEqual(self.read("hey 🦒🚗🌮🎸")["category"], "checkin")
        self.assertEqual(self.read("wyd 🥵")["category"], "checkin")
        self.assertEqual(self.read("sure. 👍")["category"], "dry")

    def test_the_words_set_the_tone(self):
        r = self.read("been so busy lately 😊🔥💯")
        self.assertEqual(r["category"], "soft_rejection")
        self.assertEqual(r["tone"]["primary"], "neutral")
        self.assertLess(r["interest"]["score"], 50)

    def test_a_meaningful_emoji_still_counts(self):
        r = self.read("lol 😭")              # laughing, not a dry "lol"
        self.assertNotEqual(r["category"], "dry")
        self.assertEqual(r["tone"]["primary"], "playful")
        self.assertEqual(self.read("😭😭")["tone"]["primary"], "playful")       # emoji only: they are the message
        self.assertEqual(self.read("🙂")["tone"]["primary"], "sarcastic")
        self.assertEqual(self.read("haha ok 🥰🥰🥰")["tone"]["primary"], "flirty")  # the words say nothing either way

    def test_emoji_cant_inflate_interest(self):
        one = self.read("omg 🔥")["interest"]["score"]
        self.assertEqual(self.read("omg 🔥🔥🔥🔥🔥")["interest"]["score"], one)  # five fires count as one
        self.assertLessEqual(one, self.read("omg")["interest"]["score"] + 10)


class OffensiveMessages(unittest.TestCase):
    """Insults, threats and harassment are flagged and answered for your safety; friendly roasting isn't."""

    def read(self, text):
        return td.decode_message(text)

    def assertHostile(self, text):
        r = self.read(text)
        self.assertEqual(r["category"], "hostile", text)
        self.assertTrue(r["flags"]["red"], text)
        self.assertFalse(r["flags"]["green"], text)
        self.assertEqual(r["tone"]["primary"], "hostile", text)
        self.assertLess(r["interest"]["score"], 40, text)

    def test_insults(self):
        for text in ["you're so stupid", "ur such a bitch", "fuck you", "nobody likes you", "you're fat and ugly",
                     "stfu", "you're a fucking loser", "go back to your country"]:
            self.assertHostile(text)

    def test_threats(self):
        for text in ["watch your back", "i know where you live", "i'll make you regret this", "kys",
                     "i'll post your nudes if you don't reply", "send nudes or i'll tell everyone"]:
            r = self.read(text)
            self.assertEqual(r["category"], "threat", text)
            self.assertTrue(r["flags"]["red"], text)
            self.assertNotIn("playful", [x["style"] for x in r["replies"]], text)  # no jokes here

    def test_backhanded_compliments(self):
        for text in ["you're pretty for a fat girl", "you're lucky i even text you", "you'd be cute if you lost weight"]:
            r = self.read(text)
            self.assertEqual(r["category"], "negging", text)
            self.assertFalse(r["flags"]["green"], text)  # not a compliment
            self.assertLess(r["interest"]["score"], 50, text)

    def test_friendly_roasting_is_not_abuse(self):
        for text in ["shut up 😭", "ur so dumb lmao", "i hate u 😭", "stfu 💀", "you're such an idiot lol"]:
            r = self.read(text)
            self.assertEqual(r["category"], "roast", text)
            self.assertFalse(r["flags"]["red"], text)

    def test_a_laugh_doesnt_soften_a_threat(self):
        for text in ["kys lol", "i know where you live 😂"]:
            self.assertEqual(self.read(text)["category"], "threat", text)

    def test_no_false_alarms_on_ordinary_texts(self):
        for text in ["i'll send it later", "i'll show you the pics tomorrow", "i'll get you a coffee",
                     "i'll find you at the party", "you'll always be my favorite", "you'll never be alone 🥺",
                     "you people are the best", "that movie was trash", "it was pretty fun for a monday",
                     "i'm so stupid lol", "my boss is an idiot", "you're so funny", "this song is stupid",
                     "i'll post the pics from the trip", "i hate this song", "i'll send you my notes"]:
            self.assertNotIn(self.read(text)["category"], ("threat", "hostile", "negging"), text)

    def test_joking_exaggeration_is_teasing(self):
        for text in ["i'm gonna kill you 😭", "you'll regret not coming lol"]:
            self.assertEqual(self.read(text)["category"], "roast", text)

    def test_middle_finger(self):
        self.assertEqual(self.read("🖕")["tone"]["primary"], "hostile")

    def test_and_u_isnt_a_question_inside_a_word(self):
        self.assertNotIn("ask_back", [s["id"] for s in self.read("so fat and ugly")["signals"]])


def rot13(text):
    """Slurs in these tests are written scrambled (ROT13), like in subtext/data/slurs.json."""
    import codecs
    return codecs.encode(text, "rot13")


class Slurs(unittest.TestCase):
    """Flagged language, by group. Aimed at you it's hate; about others it's a warning sign; said jokingly, the
    sexist group is ignored (friends call each other that) and the others get a softer flag. Disguised
    spellings are caught; ordinary look-alike words aren't. Test messages are written scrambled (ROT13)."""

    def read(self, text):
        return td.decode_message(rot13(text))

    def flags(self, text):
        r = self.read(text)
        return r, r["flags"]["red"] + r["flags"]["yellow"]

    def test_aimed_at_you_is_hate(self):
        for text, label in [("lbh'er n snttbg", "Anti-LGBTQ slur aimed at you"), ("he fhpu n puvax", "Racial slur aimed at you"),
                            ("fuhg hc snt", "Anti-LGBTQ slur aimed at you"), ("ergneq", "Ableist slur aimed at you"),
                            ("lbh avttre", "Racial slur aimed at you"), ("tb onpx gb zrkvpb jrgonpx", "Racial slur aimed at you"),
                            ("he fhpu n juber", "Sexist slur aimed at you"), ("fuhg hc ovgpu", "Sexist slur aimed at you"),
                            ("trg onpx va gur xvgpura", "Sexist slur aimed at you")]:
            r = self.read(text)
            self.assertEqual(r["category"], "hostile", rot13(text))
            self.assertIn(label, r["flags"]["red"], rot13(text))

    def test_about_someone_else_is_a_warning(self):
        r, flags = self.flags("zl hapyr hfrq gb pnyy crbcyr n puvax naq vg jnf fb onq")
        self.assertNotEqual(r["category"], "hostile")
        self.assertIn("Flagged language: racial", r["flags"]["yellow"])

    def test_joking_sexist_is_ignored(self):
        for text in ["ovgpuuu v zvffrq h 😭", "he fhpu n ubr yznb", "guvf ovgpu vf penml 😂"]:
            r, flags = self.flags(text)
            self.assertFalse([f for f in flags if "sexist" in f.lower()], rot13(text))
            self.assertNotEqual(r["category"], "hostile", rot13(text))

    def test_joking_racial_is_a_softer_flag(self):
        r, flags = self.flags("lbh'er fhpu n puvax yznb 😭")
        self.assertNotEqual(r["category"], "hostile")
        self.assertIn("Flagged language: racial (as a joke)", r["flags"]["yellow"])
        self.assertFalse(r["flags"]["red"])

    def test_disguised_spellings(self):
        for text in ["lbh'er n s@ttbg", "he n s*t", "s n t", "lbh e3gneq", "he n snnnnttbg", "he n jube3", "he n o!gpu"]:
            r = self.read(text)
            self.assertTrue([f for f in r["flags"]["red"] if "slur aimed at you" in f], rot13(text))

    def test_ordinary_words_that_contain_one(self):
        for text in ["this is so spicy", "i'm from niger", "the cocoon is cute", "scrapbook night?", "ur so funny",
                     "a dyke is a wall in the netherlands lol", "chinking glasses", "the documentary was good",
                     "kaffir lime leaves", "pass the crackers", "nip to the shops", "slant the board", "ho ho ho",
                     "he whored? no he hoarded", "the hoedown was fun", "japan trip!", "the yiddish class"]:
            r = td.decode_message(text)
            self.assertFalse([f for f in r["flags"]["red"] + r["flags"]["yellow"] if "slur" in f.lower() or "flagged language" in f.lower()], text)

    def test_slurs_never_shown(self):
        r = self.read("lbh'er n snttbg")
        shown = " ".join([h["term"] for h in r["slang"]] + [s["label"] for s in r["signals"]] + r["implications"])
        self.assertNotIn(rot13("snttbg"), shown)


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
