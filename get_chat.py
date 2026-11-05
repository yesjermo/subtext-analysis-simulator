#!/usr/bin/env python3
"""Get a conversation out of an app's export, your Mac's Messages, or screenshots.

Exports (Instagram, TikTok, Snapchat, Android SMS, WhatsApp...): files or whole folders.
  python3 get_chat.py list ~/Downloads/instagram-export
  python3 get_chat.py export ~/Downloads/instagram-export --chat "Sam Chen" --out sam.csv

iMessage / SMS on a Mac (needs Full Disk Access for your terminal):
  python3 get_chat.py imessage --list
  python3 get_chat.py imessage --chat "+15551230001" --them Jordan --out jordan.csv

Screenshots (for Hinge, Tinder, Bumble, Discord, or any app without an export):
  python3 get_chat.py screenshots ~/Desktop/hinge-shots --them Alex --out alex.txt

Then read it:   python3 cli.py --file sam.csv --them "Sam Chen"
Or open the .csv / .txt in the web app (Read a whole chat → Open a chat export).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from subtext.importers import Conversation, read_exports


def write(conv: Conversation, out: str | None) -> None:
    if not out:
        for m in conv.messages:
            print(f"{m.sender}: {m.text}")
        return
    path = Path(out)
    if path.suffix.lower() == ".csv":  # keeps the times, so reply speed can be measured
        with path.open("w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["sender", "text", "timestamp"])
            for m in conv.messages:
                w.writerow([m.sender, m.text, m.timestamp or ""])
    else:  # "Name: text" lines: easy to read and fix by hand
        path.write_text("".join(f"{m.sender}: {m.text}\n" for m in conv.messages), encoding="utf-8")
    print(f"Wrote {len(conv.messages)} messages to {path}. Read it with:\n"
          f"  python3 cli.py --file {path} --them \"{conv.them or '<their name>'}\"")


def show(convs: list[Conversation]) -> None:
    if not convs:
        print("No conversations found in those files.")
        return
    width = max(len(c.title) for c in convs)
    for c in convs:
        times = [m.timestamp for m in c.messages if m.timestamp]
        span = f"  {times[0][:10]} to {times[-1][:10]}" if times else ""
        print(f"  {c.title:<{width}}  {c.source:<9} {len(c.messages):>5} messages{span}")


def pick(convs: list[Conversation], wanted: str | None) -> Conversation:
    if not convs:
        sys.exit("No conversations found in those files.")
    if wanted is None:
        if len(convs) == 1:
            return convs[0]
        print("Several conversations in there. Pick one with --chat:")
        show(convs)
        sys.exit(1)
    w = wanted.lower()
    match = [c for c in convs if c.title.lower() == w] or [c for c in convs if w in c.title.lower()]
    if len(match) != 1:
        print(f"{'No' if not match else 'More than one'} conversation matches {wanted!r}. These are in there:")
        show(convs)
        sys.exit(1)
    return match[0]


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description="Get a conversation out of an export, iMessage or screenshots.")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("list", help="list the conversations in export files or folders")
    s.add_argument("paths", nargs="+")

    s = sub.add_parser("export", help="save one conversation from an export as .csv (keeps times) or .txt")
    s.add_argument("paths", nargs="+")
    s.add_argument("--chat", help="which conversation (its name, or part of it)")
    s.add_argument("--out", help="file to write (.csv or .txt); prints it if left out")

    s = sub.add_parser("imessage", help="read a conversation from Messages on this Mac")
    s.add_argument("--list", action="store_true", help="list your chats, busiest first")
    s.add_argument("--chat", help="the chat's number from --list, its name, or a phone number / email in it")
    s.add_argument("--them", help="their name, used instead of their phone number")
    s.add_argument("--db", help="a copy of chat.db somewhere else (default: ~/Library/Messages/chat.db)")
    s.add_argument("--out", help="file to write (.csv or .txt); prints it if left out")

    s = sub.add_parser("screenshots", help="read chat screenshots (their bubbles on the left, yours on the right)")
    s.add_argument("paths", nargs="+", help="images or folders, oldest first (names like IMG_1, IMG_2 sort right)")
    s.add_argument("--them", default="Them", help="their name")
    s.add_argument("--me", default="Me", help="your name")
    s.add_argument("--ocr", default="auto", choices=["auto", "vision", "tesseract"])
    s.add_argument("--out", help="file to write; check it and fix any misread words before reading it")
    args = p.parse_args(argv)

    if args.cmd == "list":
        show(read_exports(args.paths))
    elif args.cmd == "export":
        write(pick(read_exports(args.paths), args.chat), args.out)
    elif args.cmd == "imessage":
        from subtext.imessage import DEFAULT_DB, MessagesDB

        with MessagesDB(args.db or DEFAULT_DB) as db:
            if args.list or not args.chat:
                chats = db.list_chats()
                for c in chats[:40]:
                    who = ", ".join(c["handles"][:3]) + (" …" if len(c["handles"]) > 3 else "")
                    print(f"  {c['id']:>5}  {c['name'][:32]:<32}  {c['count']:>6} messages  last {str(c['last'])[:10]}  {who}")
                if not args.chat:
                    print("\nPick one: python3 get_chat.py imessage --chat <number> --them <their name> --out chat.csv")
                return
            chat = db.find_chat(args.chat)
            write(db.read_chat(chat["id"], them=args.them, title=args.them or chat["name"]), args.out)
    elif args.cmd == "screenshots":
        from subtext.screenshots import parse_screenshots

        msgs, engine = parse_screenshots(args.paths, them=args.them, me=args.me, engine=args.ocr)
        print(f"Read {len(msgs)} bubbles with {engine}.", file=sys.stderr)
        write(Conversation(args.them, "screenshots", msgs, args.them, args.me), args.out)


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError, PermissionError, RuntimeError) as exc:
        sys.exit(f"error: {exc}")
