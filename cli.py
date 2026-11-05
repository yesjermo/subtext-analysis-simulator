#!/usr/bin/env python3
"""Subtext on the command line: read what a text really means and how to text back.

  python3 cli.py "lowkey deleted my hinge lol"
  python3 cli.py "k." --after "omg how was the concert?? tell me everything" --delay 600
  python3 cli.py --file examples/jay.txt --them Jay
  python3 cli.py                      # paste texts one at a time
  python3 cli.py --eval               # check the reading against the labelled examples
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from subtext.chat_parser import parse_file, participants
from subtext.decoder import PLATFORMS, STAGES, decode_chat, decode_message, format_message, format_overview

ROOT = Path(__file__).resolve().parent


def run_eval() -> None:
    for name in ("labelled", "holdout"):
        path = ROOT / "subtext" / "data" / f"{name}.jsonl"
        rows = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        misses = []
        for row in rows:
            category = decode_message(row["text"])["category"]
            if category != row["expect"]:
                misses.append((row, category))
        print(
            f"{name}: {len(rows) - len(misses)}/{len(rows)} "
            "read as the expected kind of text"
        )
        for row, got in misses:
            print(f"  miss: {row['text']!r} expected {row['expect']}, got {got}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        description="Read between the lines of their texts and get reply ideas."
    )
    p.add_argument("text", nargs="*", help="one of their texts (blank: paste texts one by one)")
    p.add_argument("--file", help="read a whole chat export (WhatsApp .txt, 'Name: text', CSV or JSON)")
    p.add_argument("--them", help="with --file: whose texts to read")
    p.add_argument("--me", help="with --file: your sender name")
    p.add_argument("--after", help="what you sent right before their text (to judge effort balance)")
    p.add_argument("--delay", type=float, help="minutes they took to reply")
    p.add_argument("--platform", choices=list(PLATFORMS), help="the app you're talking on")
    p.add_argument("--stage", choices=list(STAGES), help="where things are (default: detected)")
    p.add_argument("--last", type=int, help="with --file: how many of their latest texts to show (default 5)")
    p.add_argument("--json", action="store_true", help="print the full reading as JSON")
    p.add_argument("--eval", action="store_true", help="check the reading against the labelled examples")
    args = p.parse_args(argv)

    if args.eval:
        return run_eval()
    if args.file:
        msgs = parse_file(args.file)
        if not args.them:
            sys.exit("Say whose texts to read with --them. People in that file: "
                     + ", ".join(f"{n} ({c})" for n, c in participants(msgs)))
        result = decode_chat(
            msgs,
            args.them,
            args.me,
            platform=args.platform,
            stage=args.stage,
            last=args.last,
        )
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return
        for r in result["messages"][-(args.last or 5):]:
            print(format_message(r) + "\n")
        print(format_overview(result["overview"], args.them))
        return

    def read(text: str) -> None:
        r = decode_message(
            text,
            your_last=args.after,
            delay_min=args.delay,
            platform=args.platform,
            stage=args.stage,
        )
        print(json.dumps(r, indent=2, ensure_ascii=False) if args.json else format_message(r))

    if args.text:
        return read(" ".join(args.text))
    print("Paste one of their texts and press Enter (Ctrl+D to stop).")
    while True:
        try:
            line = input("them > ").strip()
        except EOFError:
            print()
            return
        if line:
            read(line)
            print()


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as exc:
        sys.exit(f"error: {exc}")
