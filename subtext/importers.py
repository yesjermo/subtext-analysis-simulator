"""Read the chat exports each app gives you, as one or more conversations.

  read_export(path)          -> [Conversation, ...]   one file
  read_exports(paths)        -> [Conversation, ...]   several files, threads split across files merged

Formats, detected from the file itself:
  Instagram / Messenger  "Download your information" JSON: messages/inbox/<thread>/message_1.json
  TikTok                 "Download your data" JSON: user_data_tiktok.json (Direct Messages)
  Snapchat               "My Data" JSON: chat_history.json (both the per-friend and the older
                         received/sent layouts)
  Android SMS / MMS      "SMS Backup & Restore" XML
  WhatsApp, plain text, CSV, generic JSON   via chat_parser (one conversation)

iMessage lives in a database on your Mac rather than an export: see subtext/imessage.py.
Screenshots: see subtext/screenshots.py.

Times become local "YYYY-MM-DDTHH:MM:SS" strings. web/importers.js reads the same formats the same
way; tests/parity checks that they agree on the sample exports in examples/exports/.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .chat_parser import Message, parse_csv, parse_json, parse_text, participants

ME = "Me"

# Instagram's own lines for things that aren't words someone typed.
IG_SKIP = re.compile(
    r"^(liked a message|.+ sent an attachment\.|you sent an attachment\.|reacted .+ to your message"
    r"|.+ started a (video|audio) chat|(video|audio) chat ended|.+ missed a (video|audio) chat"
    r"|.+ changed the (group photo|theme)\.?|.+ named the group .+|.+ left the group\.?)$",
    re.I,
)


@dataclass
class Conversation:
    title: str
    source: str                      # instagram, tiktok, snapchat, sms, whatsapp, text, csv, json
    messages: list[Message] = field(default_factory=list)
    them: str | None = None          # whose texts to read, when the export makes it clear
    me: str | None = None

    def to_dict(self) -> dict:
        return {"title": self.title, "source": self.source, "them": self.them, "me": self.me,
                "messages": [m.to_dict() for m in self.messages]}


# ---- shared helpers ------------------------------------------------------------

def local_iso_from_ms(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000).replace(microsecond=0).isoformat()


def local_iso_from_utc(text: str) -> str | None:
    """'2026-03-28 22:10:00 UTC' -> local time."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})", text or "")
    if not m:
        return None
    t = datetime.fromisoformat(f"{m[1]}T{m[2]}").replace(tzinfo=timezone.utc)
    return local_iso_from_ms(t.timestamp() * 1000)


def fix_mojibake(text: str) -> str:
    """Instagram and Facebook write UTF-8 bytes as \\u00XX escapes, so '😭' arrives as 'ð\\x9f\\x98\\xad'."""
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def _ordered(messages: list[Message]) -> list[Message]:
    """Oldest first. Messages without a time keep their place."""
    if all(m.timestamp for m in messages):
        return sorted(messages, key=lambda m: m.timestamp)
    return messages


def _guess_sides(conv: Conversation) -> Conversation:
    """Fill in them/me from who is in it when the export didn't say."""
    people = [p for p, _ in participants(conv.messages)]
    if conv.me is None and conv.them is None and len(people) == 2:
        mine = [p for p in people if p.lower() in ("me", "you", "myself")]
        if len(mine) == 1:
            conv.me = mine[0]
    if conv.them is None and conv.me and len(people) >= 2:
        conv.them = next((p for p in people if p != conv.me), None)
    if conv.me is None and conv.them and len(people) == 2:
        conv.me = next((p for p in people if p != conv.them), None)
    return conv


# ---- Instagram / Messenger -------------------------------------------------------

def is_instagram(data) -> bool:
    return (isinstance(data, dict) and isinstance(data.get("messages"), list) and "participants" in data
            and any(isinstance(m, dict) and "sender_name" in m for m in data["messages"][:20]))


def read_instagram(data: dict) -> list[Conversation]:
    title = fix_mojibake(str(data.get("title") or "Instagram chat"))
    names = [fix_mojibake(str(p.get("name", ""))) for p in data.get("participants", []) if isinstance(p, dict)]
    msgs = []
    for m in data["messages"]:
        if not isinstance(m, dict) or "sender_name" not in m:
            continue
        text = fix_mojibake(str(m.get("content") or "")).strip()
        share = m.get("share") if isinstance(m.get("share"), dict) else None
        if not text and share and share.get("link"):
            text = str(share["link"])  # a shared reel or post: what was sent is the link
        if not text or IG_SKIP.match(text):
            continue
        ts = local_iso_from_ms(m["timestamp_ms"]) if isinstance(m.get("timestamp_ms"), (int, float)) else None
        msgs.append(Message(fix_mojibake(str(m["sender_name"])), text, ts))
    # A one-to-one thread is titled with the other person's name.
    them = title if title in names else None
    me = next((n for n in names if n != them), None) if them and len(names) == 2 else None
    return [_guess_sides(Conversation(title, "instagram", _ordered(msgs), them, me))]


# ---- TikTok --------------------------------------------------------------------

def _find_key(data, key: str):
    if isinstance(data, dict):
        if key in data:
            return data[key]
        for v in data.values():
            found = _find_key(v, key)
            if found is not None:
                return found
    return None


def is_tiktok(data) -> bool:
    return isinstance(data, dict) and isinstance(_find_key(data, "ChatHistory"), dict)


def read_tiktok(data: dict) -> list[Conversation]:
    history = _find_key(data, "ChatHistory")
    profile = _find_key(data, "ProfileMap")
    me = str(profile.get("userName")) if isinstance(profile, dict) and profile.get("userName") else None
    convs = []
    for key, rows in history.items():
        if not isinstance(rows, list):
            continue
        them = re.sub(r"^Chat History with\s+|:\s*$", "", key).strip() or key
        msgs = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            text = str(r.get("Content") or "").strip()
            sender = str(r.get("From") or "").strip()
            if not text or not sender:
                continue
            date = str(r.get("Date") or "")
            ts = date.replace(" ", "T") if re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", date) else None
            msgs.append(Message(sender, text, ts))
        if msgs:
            convs.append(_guess_sides(Conversation(them, "tiktok", _ordered(msgs), them, me)))
    return convs


# ---- Snapchat --------------------------------------------------------------------

SNAP_TEXT_TYPES = {"TEXT", "TEXT_AND_MEDIA", ""}


def is_snapchat(data) -> bool:
    if not isinstance(data, dict):
        return False
    if "Received Saved Chat History" in data or "Sent Saved Chat History" in data:
        return True
    rows = [r for v in data.values() if isinstance(v, list) for r in v[:5]]
    return bool(rows) and all(isinstance(r, dict) and "From" in r and "Created" in r for r in rows)


def read_snapchat(data: dict) -> list[Conversation]:
    by_friend: dict[str, list[Message]] = {}
    me = ME

    def add(friend: str, sender: str, row: dict) -> None:
        text = str(row.get("Content") if row.get("Content") is not None else row.get("Text") or "").strip()
        if not text or str(row.get("Media Type", "TEXT")).upper() not in SNAP_TEXT_TYPES:
            return
        by_friend.setdefault(friend, []).append(Message(sender, text, local_iso_from_utc(str(row.get("Created", "")))))

    if "Received Saved Chat History" in data or "Sent Saved Chat History" in data:
        for row in data.get("Received Saved Chat History", []) or []:
            if isinstance(row, dict) and row.get("From"):
                add(str(row["From"]), str(row["From"]), row)
        for row in data.get("Sent Saved Chat History", []) or []:
            if isinstance(row, dict) and row.get("To"):
                add(str(row["To"]), ME, row)
    else:
        for friend, rows in data.items():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict):
                    add(str(friend), ME if row.get("IsSender") else str(row.get("From") or friend), row)
    return [Conversation(f, "snapchat", _ordered(msgs), f, me) for f, msgs in by_friend.items() if msgs]


# ---- Android SMS Backup & Restore ------------------------------------------------
# Read with patterns rather than an XML library: the app writes emoji as pairs of UTF-16 number
# codes (&#55357;&#56898;), which strict XML parsers reject, and web/importers.js reads it the same way.

SMS_NODE = re.compile(r"<sms\b([^>]*?)/?>|<mms\b([^>]*)>([\s\S]*?)</mms>")
XML_ATTR = re.compile(r'([\w:.-]+)="([^"]*)"')
XML_REF = re.compile(r"&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);")
NAMED = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}


def xml_unescape(text: str) -> str:
    def ref(m: re.Match) -> str:
        r = m[1]
        if r in NAMED:
            return NAMED[r]
        return chr(int(r[2:], 16) if r.startswith("#x") else int(r[1:]))
    out = XML_REF.sub(ref, text)
    return out.encode("utf-16", "surrogatepass").decode("utf-16")  # join surrogate pairs into emoji


def _attrs(raw: str) -> dict:
    return {k: xml_unescape(v) for k, v in XML_ATTR.findall(raw)}


def is_sms_xml(raw: str) -> bool:
    return "<smses" in raw[:2000]


def read_sms_xml(raw: str) -> list[Conversation]:
    by_contact: dict[str, list[Message]] = {}
    for m in SMS_NODE.finditer(raw):
        if m[1] is not None:
            a = _attrs(m[1])
            text, sent = a.get("body", ""), a.get("type") == "2"
        else:
            a = _attrs(m[2])
            parts = [_attrs(p) for p in re.findall(r"<part\b([^>]*?)/?>", m[3])]
            text = " ".join(p.get("text", "") for p in parts if p.get("ct") == "text/plain" and p.get("text", "") != "null")
            sent = a.get("msg_box") == "2"
        text = text.strip()
        if not text or text == "null":
            continue
        name = a.get("contact_name")
        contact = name if name and name != "(Unknown)" else (a.get("address") or "Unknown")
        date = a.get("date", "")
        ts = local_iso_from_ms(int(date)) if date.isdigit() else None
        by_contact.setdefault(contact, []).append(Message(ME if sent else contact, text, ts))
    return [Conversation(c, "sms", _ordered(msgs), c, ME) for c, msgs in by_contact.items()]


# ---- entry points ----------------------------------------------------------------

def read_text_export(name: str, raw: str) -> list[Conversation]:
    """Detect the format from the contents (and the extension for CSV) and read it."""
    lower = name.lower()
    stripped = raw.lstrip("﻿ \n\r\t")
    if lower.endswith(".xml") or stripped.startswith("<"):
        if is_sms_xml(stripped):
            return read_sms_xml(stripped)
        raise ValueError(f"{name}: an XML file Subtext doesn't know. It reads SMS Backup & Restore exports.")
    data = None
    if lower.endswith(".json") or (stripped.startswith(("{", "[")) and not lower.endswith((".txt", ".csv"))):
        try:
            data = json.loads(stripped)
        except ValueError:
            if lower.endswith(".json"):
                raise ValueError(f"{name}: this .json file isn't valid JSON. Was the download cut short?")
    if data is not None:
        if is_instagram(data):
            return read_instagram(data)
        if is_tiktok(data):
            return read_tiktok(data)
        if is_snapchat(data):
            return read_snapchat(data)
        msgs = parse_json(stripped)
        return [_guess_sides(Conversation(Path(name).stem, "json", msgs))] if msgs else []
    if lower.endswith(".csv"):
        msgs = parse_csv(stripped)
        return [_guess_sides(Conversation(Path(name).stem, "csv", msgs))] if msgs else []
    msgs = parse_text(raw)
    if not msgs:
        return []
    # WhatsApp names the file after the other person: "WhatsApp Chat with Jay.txt"
    m = re.match(r"^WhatsApp Chat (?:with|-)\s*(.+?)(?:\s*\(\d+\))?$", Path(name).stem, re.I)
    if m:
        return [_guess_sides(Conversation(m[1], "whatsapp", msgs, m[1] if any(x.sender == m[1] for x in msgs) else None))]
    source = "whatsapp" if any(x.timestamp for x in msgs) else "text"
    return [_guess_sides(Conversation(Path(name).stem, source, msgs))]


def read_export(path: str | Path) -> list[Conversation]:
    path = Path(path)
    return read_text_export(path.name, path.read_text(encoding="utf-8", errors="replace"))


def merge_conversations(convs: list[Conversation]) -> list[Conversation]:
    """Instagram splits long threads into message_1.json, message_2.json...: put them back together."""
    out: dict[tuple[str, str], Conversation] = {}
    for c in convs:
        key = (c.source, c.title)
        if key not in out:
            out[key] = Conversation(c.title, c.source, list(c.messages), c.them, c.me)
            continue
        seen = {(m.sender, m.text, m.timestamp) for m in out[key].messages}
        out[key].messages += [m for m in c.messages if (m.sender, m.text, m.timestamp) not in seen]
        out[key].messages = _ordered(out[key].messages)
    # Busiest conversations first: they're the ones worth reading.
    return sorted(out.values(), key=lambda c: -len(c.messages))


def read_exports(paths: list[str | Path]) -> list[Conversation]:
    convs: list[Conversation] = []
    for p in paths:
        p = Path(p)
        files = sorted(p.rglob("*")) if p.is_dir() else [p]
        for f in files:
            if f.is_file() and f.suffix.lower() in (".json", ".xml", ".txt", ".csv"):
                convs += read_export(f)
    return merge_conversations(convs)
