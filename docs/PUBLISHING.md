# Putting Subtext online

Subtext is a set of static files, so GitHub Pages can host it for free. Nothing you paste is sent to
GitHub or anywhere else: Pages only serves the files, and everything runs in the visitor's browser.

## 1. Upload the repository

Either from a terminal:

```bash
gh auth login
gh repo create genz-text-decoder --public --source . --push
```

or create an empty repository on github.com and follow its "push an existing repository" steps.

The repository has to be **public** for free GitHub Pages (a private one needs a paid plan). Before
you push, check you're happy for everything in the folder to be public. The sample chats, exports and
screenshots are all fictional; `.taste-skill/` (design-check screenshots) is ignored and won't upload.

## 2. Turn on GitHub Pages

1. On github.com, open the repository → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Set **Branch** to `main` and the folder to `/ (root)`, then **Save**.
4. Wait a minute or two. The address appears at the top of that page:
   `https://yesjermo.github.io/subtext-analysis-simulator/`

The address opens the app: `index.html` at the top of the repository forwards to `web/`, and keeps
any link after the `#`.

## 3. Check it

- Open the address on your computer and on your phone.
- Try a link that fills in a text:
  `https://yesjermo.github.io/subtext-analysis-simulator/web/#decode?t=wyd`
- Try **Paste from clipboard** on your phone. Online, browsers allow it (Safari shows a small *Paste*
  bubble to tap; Chrome may ask once for permission).

## 4. On your phone

Done: the README buttons point at the live site, the app installs to the home screen, works offline,
and appears in Android's share menu. Setup for each phone, and the iPhone shortcut:
[PHONE.md](PHONE.md).

## Updating the live site

GitHub Pages republishes whenever the repository changes. Upload the changed files (or `git push`);
about a minute later, the next visit picks up the new version. Visitors who installed Subtext get it
too: the app always checks for new files first and only uses its offline copy without a connection.

## Links that open Subtext with something filled in

These work locally and online. What comes after `#` never leaves the browser, and Subtext clears it
from the address bar once it has read it.

| Link | Opens |
|---|---|
| `#take?t=<text>` | Decided for you: one text is decoded, a "Name: text" chat goes to Read a whole chat |
| `#decode?t=<their text>` | Decode a text, already decoded. Optional: `&after=<your text before it>`, `&app=snapchat` (or instagram, tiktok, imessage, whatsapp, dating_app, discord), `&stage=flirting` |
| `#chat?chat=<a chat, one "Name: text" per line>` | Read a whole chat |
| `#library?q=<word or emoji>` | The slang library, searched |

Text in a link has to be URL-encoded (spaces as `%20`, new lines as `%0A`); Shortcuts and most tools do
this for you.

## What still reaches other servers

- The **Inter** font loads from Google Fonts.
- The **screenshot reader** (Tesseract.js) downloads from the jsDelivr CDN the first time you open a
  screenshot. The screenshots themselves are read on the device.
- The README's badges load from shields.io (only when someone views the README, not the app).
