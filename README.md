<h1 align="center">Subtext (subtext analysis simulator)</h1>

<p align="center"><b>Read what their text really means, and what to text back.</b></p>

<p align="center">
  <img alt="tests: 29/29 passing" src="https://img.shields.io/badge/tests-29%2F29%20passing-2ea44f">
  <img alt="held-out accuracy: 31/32" src="https://img.shields.io/badge/held--out%20accuracy-31%2F32-2ea44f">
  <img alt="Python 3.10+, standard library only" src="https://img.shields.io/badge/Python-3.10%2B%20%C2%B7%20stdlib%20only-3776AB?logo=python&logoColor=white">
  <img alt="JavaScript, no build step" src="https://img.shields.io/badge/JavaScript-no%20build%20step-F7DF1E?logo=javascript&logoColor=black">
  <img alt="dependencies: none" src="https://img.shields.io/badge/dependencies-none-2ea44f">
  <br>
  <img alt="slang: 343 words, 94 emoji, 63 phrases" src="https://img.shields.io/badge/slang%20library-343%20words%20%C2%B7%2094%20emoji%20%C2%B7%2063%20phrases-4cb3f0">
  <img alt="apps: Snapchat, Instagram, TikTok, iMessage, WhatsApp, dating apps, Discord" src="https://img.shields.io/badge/reads-Snap%20%C2%B7%20IG%20%C2%B7%20TikTok%20%C2%B7%20iMessage%20%C2%B7%20WhatsApp%20%C2%B7%20Hinge%20%C2%B7%20Discord-4cb3f0">
  <img alt="privacy: runs in your browser, nothing uploaded" src="https://img.shields.io/badge/privacy-nothing%20uploaded-111111">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2ea44f">
</p>

<!-- The buttons open the app from this folder. Once it's published (for example with GitHub Pages),
     point them at the live address, e.g. https://<username>.github.io/genz-text-decoder/web/ -->
<p align="center">
  <a href="web/index.html#decode"><img alt="Decode a text" height="40" src="https://img.shields.io/badge/%E2%96%B6%20%20decode%20a%20text-open%20subtext-000000?style=for-the-badge&labelColor=4cb3f0&color=000000"></a>
  &nbsp;
  <a href="web/index.html#chat"><img alt="Read a demo chat" height="40" src="https://img.shields.io/badge/%E2%96%B6%20%20read%20a%20demo%20chat-maya%20%C2%B7%20jay-000000?style=for-the-badge&labelColor=e6e6e6&color=000000"></a>
</p>
<p align="center">
  <i>Opens in your browser. No install, no account, nothing you paste leaves your device.</i>
</p>

<p align="center">
  <img alt="Decoding 'lowkey deleted my hinge lol': testing the waters, interest 74 out of 100, with three suggested replies" src="docs/screen-decode.jpg" width="72%">
  &nbsp;
  <img alt="The same reading on a phone" src="docs/screen-phone.jpg" width="21.5%">
</p>

Paste what your crush, talking stage or situationship sent. Subtext reads the words, the emoji and
how it was typed, then tells you:

- the **tone** and how they probably **feel**;
- what it **implies** ("lowkey deleted my hinge lol" is them checking whether you'll say "me too");
- how **interested** they seem, from 0 to 100;
- which **stage** you're in: talking, flirting, getting physical, about to be official, situationship or fading;
- the **ghosting risk**, with the reasons;
- three ways to **text back** (match their energy, playful, sincere) and what to **avoid**.

Give it a whole chat and it also tracks interest text by text, who puts in more effort, who texts
first, how fast each of you replies, and your next move.

<p align="center">
  <img alt="Reading a whole chat: interest text by text, effort balance and the next move" src="docs/screen-chat.jpg" width="86%">
</p>

It runs entirely in your browser. Nothing you paste is uploaded.

## Use it

Open `web/index.html` in a browser. That's it: no install, no server, no build step.

Or serve the folder if you prefer:

```bash
python3 -m http.server 8790 --directory web
```

Then open http://127.0.0.1:8790. The four screens:

| Screen | What it's for |
|---|---|
| **Decode a text** | One text, with each slang word and emoji underlined and decoded where it sits |
| **Read a whole chat** | Open an Instagram, TikTok, Snapchat, WhatsApp or Android SMS export, screenshots, or an iMessage CSV; paste a chat; or try the two demo chats |
| **Slang library** | Every word, emoji and phrase Subtext knows, searchable by spelling or meaning |
| **Stages and apps** | What each stage looks like, what to do, the ghosting signs, and what each app's habits mean |

Pick the app you're talking on in the top bar (Snapchat, Instagram, TikTok, iMessage, WhatsApp,
dating apps, Discord) and every reading adds that app's norms.

## Bring a chat in

- **Paste anywhere.** Copy their text, a whole chat, or a screenshot, then press ⌘V / Ctrl+V anywhere
  on the page. One text is decoded; a chat with two people goes to *Read a whole chat*; a screenshot
  is read and shown for you to check.
- **Drop anywhere.** Drag an export file, several screenshots, or selected text onto the page.
- **Paste from clipboard.** One tap on a phone, where there's no keyboard shortcut.
- **Links.** `web/#decode?t=wyd` opens with that text already decoded; `#chat?chat=` and
  `#library?q=` work the same way. The text stays in the browser and is cleared from the address bar.
  This is what the share-sheet shortcuts in [docs/PUBLISHING.md](docs/PUBLISHING.md) will use.

To put Subtext online with GitHub Pages and add it to your phone's share menu, see
[docs/PUBLISHING.md](docs/PUBLISHING.md).

## Get your chats

None of these apps lets another app read your DMs (their APIs are for business accounts and bots),
so Subtext reads the copy of your data each app lets you download. You download it, you open it
here, and it never leaves your device.

| App | How | Open in Subtext |
|---|---|---|
| Instagram, Facebook Messenger | Accounts Center → Your information and permissions → Download your information → Messages, **JSON** | the person's folder in `messages/inbox/`, or its `message_1.json` |
| TikTok | Settings and privacy → Account → Download your data → **JSON** | `user_data_tiktok.json` (pick a thread) |
| Snapchat | accounts.snapchat.com → My Data → Chat History, **Export JSON files** on | `json/chat_history.json` (saved and unopened chats only) |
| WhatsApp | the chat → their name → Export chat → Without media | the `.txt` |
| Android texts | the SMS Backup & Restore app | the `.xml` (pick a contact) |
| iMessage, iPhone texts | on a Mac: `python3 get_chat.py imessage --list` (needs Full Disk Access) | the `.csv` it writes |
| Hinge, Tinder, Bumble, Discord | their downloads hold only *your* messages, so take screenshots | the screenshots, oldest first |

Screenshots are read on your device: in the browser with Tesseract.js (downloaded once from a CDN),
or on the command line with Apple Vision on a Mac or `tesseract`. Their bubbles on the left, yours on
the right, light or dark mode. Check the words it read before decoding; it can misread a few letters.

```bash
python3 get_chat.py list ~/Downloads/instagram-export                       # every conversation inside
python3 get_chat.py export ~/Downloads/instagram-export --chat "Sam" --out sam.csv
python3 get_chat.py imessage --list
python3 get_chat.py imessage --chat 12 --them Jordan --out jordan.csv
python3 get_chat.py screenshots ~/Desktop/hinge-shots --them Alex --out alex.txt
```

## Command line

Python 3.10+, standard library only.

```bash
python3 cli.py "lowkey deleted my hinge lol"
python3 cli.py "k." --after "omg how was the concert?? tell me everything" --delay 600
python3 cli.py "u up?" --platform snapchat
python3 cli.py --file examples/jay.txt --them Jay
python3 cli.py --file examples/exports/tiktok/user_data_tiktok.json --chat jaylen
python3 cli.py --eval
```

## What it knows

Everything lives in `subtext/data/`:

- **343 slang terms**, each tagged by where it comes from: mainstream Gen Z, Gen Alpha, AAVE, Black
  and Latinx LGBTQ+ ballroom culture, Twitter/Discord, TikTok algospeak, UK, Australian, Spanish and
  Spanglish, Arabic, K-pop, gaming and millennial;
- **94 emoji** by their Gen Z meaning (😭 is laughing, 🙂 is passive-aggressive, 👍 reads cold);
- **63 subtext patterns**, from "my friends keep asking about you" to "we'll see" to "don't be boring";
- a **reply playbook** for 23 kinds of text, 6 stages and 7 apps.

The data is curated by hand from how these words are used in public. No real person's messages were
collected. The example texts are written for the project.

## How good is it

`python3 cli.py --eval` checks which kind of text each example is read as:

- `labelled.jsonl`: 135/135. Used while writing the patterns, so this only shows nothing broke.
- `holdout.jsonl`: 31/32. Written afterwards and not tuned against.

Real chats are messier, especially with sarcasm and inside jokes. It's a rule-based reading that
shows its reasons, not mind reading; when it matters, ask the person.

## Safety

- Pressure, guilt-tripping and controlling texts are flagged red; the advice is to hold your boundary.
- Advice for getting physical is about pace and consent, and about not sending intimate pictures.
- Texts that may mean self-harm (including algospeak like "unalive") get a check-in and a crisis line
  (988 in the US), not dating strategy.

## Project layout

```
subtext/decoder.py      the engine: one text, or a whole chat
subtext/chat_parser.py  WhatsApp, "Name: text", CSV and JSON chats → messages
subtext/importers.py    Instagram, TikTok, Snapchat and SMS Backup exports → conversations
subtext/imessage.py     iMessage and SMS from the Messages database on a Mac
subtext/screenshots.py  chat screenshots → messages (Apple Vision or tesseract)
subtext/data/           slang, emoji, signals, playbook, labelled examples
cli.py                  command line: decode a text or a chat
get_chat.py             command line: get a conversation out of an export, iMessage or screenshots
web/index.html          the app (open it directly)
web/app.js, app.css     the four screens
web/engine.js           the same engine in JavaScript
web/parse.js            the same chat parser in JavaScript
web/importers.js        the same importers in JavaScript
web/screenshots.js      reads screenshots in the browser (Tesseract.js)
web/charts.js           small SVG charts
web/data.js             generated by tools/build_web.py; don't edit by hand
docs/                   PUBLISHING.md (putting it online) and the screenshots used in this README
index.html              forwards the repository's home address to web/ (for GitHub Pages)
examples/               two demo chats, and a sample export from each app in exports/ (all fictional)
tests/                  python3 -m unittest discover tests
```

After changing anything in `subtext/data/` or `examples/`, run `python3 tools/build_web.py`. The
tests check that the Python and JavaScript sides give the same reading for every example and demo
chat, and read every sample export the same way (both need Node). The screenshot test runs only where
an OCR engine is installed.

## Credits

The engine and data started in [TextBack Analysis Engine](https://github.com/yesjermo/textback-analysis-engine).
The interface follows the "true-black flat" app style from the tasteskill design skill. MIT licence.
