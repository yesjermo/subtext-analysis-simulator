"""Score the screenshot reader on tests/fixtures/shots: python3 tests/fixtures/score_shots.py [--debug name]"""
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from subtext.screenshots import bubbles_from_page, ocr_vision  # noqa: E402

SHOTS = ROOT / "tests" / "fixtures" / "shots"
EXPECTED = json.loads((SHOTS / "expected.json").read_text())["convo"]


def score(got: list[dict]) -> tuple[int, list[str]]:
    """Messages read with the right side and nearly the right words, in order."""
    notes, right, j = [], 0, 0
    for want in EXPECTED:
        match = next((k for k in range(j, len(got)) if SequenceMatcher(None, got[k]["text"].lower(), want["text"].lower()).ratio() >= 0.8), None)
        if match is None:
            notes.append(f"missed: {want['text']!r}")
            continue
        extra = got[j:match]
        notes += [f"extra: {e['side']} {e['text']!r}" for e in extra]
        if got[match]["side"] == want["side"]:
            right += 1
        else:
            notes.append(f"wrong side: {want['text']!r} read as {got[match]['side']}")
        j = match + 1
    notes += [f"extra: {e['side']} {e['text']!r}" for e in got[j:]]
    return right, notes


if __name__ == "__main__":
    debug = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--debug" else None
    total = 0
    for img in sorted(SHOTS.glob("*.png")):
        page = ocr_vision([img])[0]
        if debug and debug in img.name:
            for ln in page["lines"]:
                print(f"   {ln['x0']:.2f}-{ln['x1']:.2f} y{ln['y0']:.3f}  {ln['text']!r}")
        got = bubbles_from_page(page)
        right, notes = score(got)
        total += right
        print(f"{img.stem:16} {right}/{len(EXPECTED)}  " + "; ".join(notes))
    print(f"TOTAL {total}/{len(EXPECTED) * len(list(SHOTS.glob('*.png')))}")
