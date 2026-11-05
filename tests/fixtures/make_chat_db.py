"""Build a small fake Messages database (chat.db) with the tables and columns subtext/imessage.py reads.

  python3 tests/fixtures/make_chat_db.py out.db
"""
import sqlite3
import sys

APPLE_EPOCH = 978307200


def attributed(text: str) -> bytes:
    """An archived NSAttributedString the way Messages stores it when `text` is empty."""
    data = text.encode("utf-8")
    length = bytes([len(data)]) if len(data) < 0x80 else b"\x81" + len(data).to_bytes(2, "little")
    return (b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00"
            b"\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+" + length + data + b"\x86\x84\x02iI\x01")


def build(path: str) -> None:
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
        CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT);
        CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, is_from_me INTEGER,
                              date INTEGER, handle_id INTEGER, associated_message_type INTEGER DEFAULT 0);
        CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
        CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
        INSERT INTO handle VALUES (1, '+15551230001'), (2, 'mia@example.com');
        INSERT INTO chat VALUES (1, '+15551230001', ''), (2, 'mia@example.com', 'Mia');
        INSERT INTO chat_handle_join VALUES (1, 1), (2, 2);
    """)
    start = 1775400000 - APPLE_EPOCH  # early April 2026, in Apple's seconds
    rows = [  # chat, text, attributed text, from me, minutes, handle, tapback type
        (1, "are u free friday?", None, 0, 0, 1, 0),
        (1, None, "yes!! what were u thinking 😭", 1, 12, 1, 0),   # Ventura+: words only in attributedBody
        (1, "￼", None, 0, 13, 1, 0),                           # a photo
        (1, "that thai place on 5th?", None, 0, 15, 1, 0),
        (1, 'Loved “that thai place on 5th?”', None, 1, 16, 1, 2000),  # a tapback, not a message
        (1, "perfect, see u there", None, 1, 40, 1, 0),
        (2, "did u finish the essay", None, 0, 300, 2, 0),
    ]
    for i, (chat, text, rich, me, mins, handle, assoc) in enumerate(rows, start=1):
        date = (start + mins * 60) * 1_000_000_000  # nanoseconds since 2001, as on recent macOS
        db.execute("INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?)",
                   (i, text, attributed(rich) if rich else None, me, date, handle, assoc))
        db.execute("INSERT INTO chat_message_join VALUES (?, ?)", (chat, i))
    db.commit()
    db.close()


if __name__ == "__main__":
    build(sys.argv[1])
