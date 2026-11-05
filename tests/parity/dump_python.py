"""Dump Python readings for tests/parity/compare_js.js:  python3 tests/parity/dump_python.py out.json"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from subtext.chat_parser import parse_file  # noqa: E402
from subtext.decoder import decode_chat, decode_message  # noqa: E402

LONG = "omg i just got back from the most chaotic day ever and i need to tell you about it"
texts = [
    json.loads(line)["text"]
    for filename in ("labelled.jsonl", "holdout.jsonl")
    for line in (ROOT / "subtext" / "data" / filename)
    .read_text(encoding="utf-8")
    .splitlines()
    if line.strip()
]
texts += ["heyyy wyd", "ASDFGHJKL STOP", "omg... ok lol", "sure.", "sooo what are we doing friday?? 😭💀🫶"]

out = {
    "inputs": texts,
    "chats": [],
    "one": [
        decode_message(
            text,
            your_last=LONG if i % 3 == 0 else None,
            delay_min=[None, 2, 400, 2000][i % 4],
            platform=["snapchat", None][i % 2],
        )
        for i, text in enumerate(texts)
    ],
}
for demo in json.loads((ROOT / "examples" / "demos.json").read_text(encoding="utf-8")):
    messages = parse_file(ROOT / demo["file"])
    out["chats"].append(
        {
            "msgs": [message.to_dict() for message in messages],
            "them": demo["them"],
            "me": demo["me"],
            "py": decode_chat(messages, demo["them"], demo["me"]),
        }
    )
Path(sys.argv[1]).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
