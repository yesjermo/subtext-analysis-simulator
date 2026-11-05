"""Read iMessage and SMS conversations straight from the Messages database on a Mac.

Apple has no API or export button for Messages, but every chat on a Mac is in
~/Library/Messages/chat.db (SQLite). This reads a private copy of it, never the live file.

  list_chats()                       -> [{"id", "name", "handles", "count", "last"}]  busiest first
  read_chat(chat_id, them="Jay")     -> Conversation

The Terminal (or app) running this needs Full Disk Access: System Settings → Privacy & Security →
Full Disk Access. Nothing is changed in the database and nothing leaves your Mac.
"""
from __future__ import annotations

import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .chat_parser import Message
from .importers import ME, Conversation

DEFAULT_DB = Path.home() / "Library" / "Messages" / "chat.db"
APPLE_EPOCH = 978307200  # 2001-01-01 in Unix time
OBJECT_REPLACEMENT = "￼"  # where an attachment sat in the text

ACCESS_HELP = (
    "Couldn't open the Messages database. Give the app you're running this from (Terminal, iTerm, "
    "VS Code...) Full Disk Access in System Settings → Privacy & Security → Full Disk Access, "
    "then quit and reopen it and try again."
)


def apple_time(value: int | float | None) -> str | None:
    """Messages counts from 2001-01-01, in seconds on old macOS and nanoseconds since High Sierra."""
    if not value:
        return None
    seconds = value / 1e9 if value > 1e11 else value
    t = datetime.fromtimestamp(seconds + APPLE_EPOCH, tz=timezone.utc).astimezone()
    return t.replace(tzinfo=None, microsecond=0).isoformat()


def text_from_attributed_body(blob: bytes | None) -> str | None:
    """Since macOS Ventura the words are often only in `attributedBody`, an archived NSAttributedString.

    The string follows the 'NSString' class name: a few marker bytes, then a length (one byte, or
    0x81 + two bytes, or 0x82 + three bytes, little-endian), then the UTF-8 text.
    """
    if not blob:
        return None
    at = blob.find(b"NSString")
    if at < 0:
        return None
    rest = blob[at + len(b"NSString"):]
    plus = rest.find(b"+")  # the marker right before the length
    if plus < 0 or plus > 8:
        return None
    rest = rest[plus + 1:]
    if not rest:
        return None
    first = rest[0]
    if first == 0x81:
        length, start = int.from_bytes(rest[1:3], "little"), 3
    elif first == 0x82:
        length, start = int.from_bytes(rest[1:4], "little"), 4
    else:
        length, start = first, 1
    text = rest[start:start + length].decode("utf-8", errors="replace")
    return text or None


class MessagesDB:
    """A read-only copy of chat.db, so a locked or busy live database is never touched."""

    def __init__(self, path: str | Path = DEFAULT_DB):
        path = Path(path).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"No Messages database at {path}. Is this a Mac with Messages set up?")
        self._tmp = tempfile.TemporaryDirectory(prefix="subtext-imessage-")
        copy = Path(self._tmp.name) / "chat.db"
        try:
            shutil.copy2(path, copy)
            for extra in ("-wal", "-shm"):  # recent messages may still be in the write-ahead log
                side = path.with_name(path.name + extra)
                if side.exists():
                    shutil.copy2(side, copy.with_name(copy.name + extra))
        except PermissionError as exc:
            self._tmp.cleanup()
            raise PermissionError(ACCESS_HELP) from exc
        try:
            self.conn = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
            self.conn.execute("SELECT 1 FROM message LIMIT 1")
        except sqlite3.DatabaseError as exc:
            self._tmp.cleanup()
            raise PermissionError(ACCESS_HELP) from exc
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(message)")}
        # Tapbacks ("Loved 'see u there'") are messages too; they have an associated_message_type.
        self._only_texts = "AND m.associated_message_type = 0" if "associated_message_type" in cols else ""
        self._has_body = "attributedBody" in cols

    def close(self) -> None:
        self.conn.close()
        self._tmp.cleanup()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def list_chats(self) -> list[dict]:
        rows = self.conn.execute(f"""
            SELECT c.ROWID, c.chat_identifier, COALESCE(c.display_name, ''), COUNT(m.ROWID), MAX(m.date)
            FROM chat c
            JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
            JOIN message m ON m.ROWID = cmj.message_id
            WHERE 1 = 1 {self._only_texts}
            GROUP BY c.ROWID ORDER BY COUNT(m.ROWID) DESC""").fetchall()
        out = []
        for rowid, ident, display, count, last in rows:
            handles = [h for (h,) in self.conn.execute("""
                SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id
                WHERE chj.chat_id = ? ORDER BY h.id""", (rowid,))]
            out.append({"id": rowid, "name": display or ident, "handles": handles, "count": count, "last": apple_time(last)})
        return out

    def find_chat(self, wanted: str) -> dict:
        """A chat by its number in list_chats, its name, or a phone number / email in it."""
        chats = self.list_chats()
        w = wanted.strip().lower()
        digits = "".join(ch for ch in w if ch.isdigit())
        for c in chats:
            if str(c["id"]) == w or c["name"].lower() == w or any(h.lower() == w for h in c["handles"]):
                return c
        if len(digits) >= 7:  # "555 123 0001" matches "+15551230001"
            for c in chats:
                if any("".join(ch for ch in h if ch.isdigit()).endswith(digits) for h in c["handles"] + [c["name"]]):
                    return c
        raise ValueError(f"No chat matches {wanted!r}. List them with: python3 get_chat.py imessage --list")

    def read_chat(self, chat_id: int, them: str | None = None, title: str | None = None) -> Conversation:
        body = ", m.attributedBody" if self._has_body else ", NULL"
        rows = self.conn.execute(f"""
            SELECT m.text{body}, m.is_from_me, m.date, COALESCE(h.id, '')
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE cmj.chat_id = ? {self._only_texts}
            ORDER BY m.date, m.ROWID""", (chat_id,)).fetchall()
        handles = {h for *_, h in rows if h}
        msgs = []
        for text, attributed, from_me, date, handle in rows:
            words = text if text else text_from_attributed_body(attributed)
            words = (words or "").replace(OBJECT_REPLACEMENT, "").strip()
            if not words:
                continue  # a photo, a sticker, an unsent message
            # In a one-to-one chat every message not from you is from them, whatever the handle.
            sender = ME if from_me else (them if them and (len(handles) <= 1) else (handle or them or "Them"))
            msgs.append(Message(sender, words, apple_time(date)))
        name = title or them or (next(iter(handles)) if len(handles) == 1 else f"Chat {chat_id}")
        one_to_one = len(handles) <= 1
        return Conversation(name, "imessage", msgs, (them or next(iter(handles), None)) if one_to_one else None, ME)
