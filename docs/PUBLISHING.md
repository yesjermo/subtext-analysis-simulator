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
   `https://<your-username>.github.io/genz-text-decoder/`

The address opens the app: `index.html` at the top of the repository forwards to `web/`, and keeps
any link after the `#`.

## 3. Check it

- Open the address on your computer and on your phone.
- Try a link that fills in a text:
  `https://<your-username>.github.io/genz-text-decoder/web/#decode?t=wyd`
- Try **Paste from clipboard** on your phone. Online, browsers allow it (Safari shows a small *Paste*
  bubble to tap; Chrome may ask once for permission).

## 4. Point the README buttons at it

In `README.md`, replace `web/index.html#decode` and `web/index.html#chat` in the two launch buttons
with the live address, for example `https://<your-username>.github.io/genz-text-decoder/web/#decode`.

## 5. Then: the share sheet (step 2)

Once there's an `https://` address, Subtext can become an app on your home screen and appear in the
**Share** menu:

- **Install it** (a web app manifest, icons and an offline cache): "Add to Home Screen" on iPhone,
  "Install app" on Android and desktop Chrome.
- **Android share sheet**: select text in any app, or share a screenshot or WhatsApp's *Export chat*
  file → **Subtext**, and it opens already reading it.
- **iPhone share sheet**: iOS doesn't let websites in, so an Apple Shortcut, *Decode with Subtext*, does
  it: it takes the text you shared (or reads the words in a screenshot with the iPhone's own text
  recognition) and opens Subtext with them filled in, using the `#decode?t=` and `#chat?chat=` links
  that are already built in.

## Links that open Subtext with something filled in

These work locally and online. What comes after `#` never leaves the browser, and Subtext clears it
from the address bar once it has read it.

| Link | Opens |
|---|---|
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
