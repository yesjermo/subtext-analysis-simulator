# Subtext on your phone

Live at **https://yesjermo.github.io/subtext-analysis-simulator/web/**

Everything below runs on the phone. What you share or paste isn't sent anywhere.

## Android: install it, then share to it

1. Open the address in **Chrome** (or Edge or Samsung Internet).
2. Tap **⋮** → **Install app** (on some phones: **Add to Home screen** → **Install**).
3. Open Subtext from the home screen once.

Now **Subtext** is in the share menu of every app:

| In the app | Share → Subtext opens |
|---|---|
| Select one message → Share | Decode a text, already decoded |
| Select several messages → Share | Read a whole chat, if they're in "Name: text" lines |
| A screenshot → Share | The screenshot is read; check the words, then Read this chat |
| WhatsApp: the chat → ⋮ → More → Export chat → Without media → Subtext | Read a whole chat |
| An export file (.json, .xml, .txt, .csv) from Files → Share | Read a whole chat |

If Subtext doesn't show up in the share menu, open it from the home screen once more, or remove and
reinstall it: Android only adds it after the app has been installed and opened.

## iPhone: add it to your home screen

1. Open the address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.

It opens full screen, like an app, and works offline after the first visit.

iOS doesn't let websites appear in the share menu, so there are two easy ways in:

**Screenshots and copied messages (no setup).**
Copy a message (press and hold → **Copy**), or a screenshot (open it in Photos → **Share** → **Copy**).
Open Subtext and tap **Paste from clipboard**. Tap **Paste** in the little bubble Safari shows.
Screenshots are read with their bubbles' sides kept, so this is the best way for a whole chat.

**A "Decode with Subtext" shortcut in the share menu (two minutes to set up).**

1. Open the **Shortcuts** app → **+** (new shortcut). Name it **Decode with Subtext**.
2. Tap the **ⓘ** (Details) → turn on **Show in Share Sheet**.
3. At the top, set it to receive **Text** from **Share Sheet**, and *If there's no input:* **Get Clipboard**.
4. Add these actions, in order:
   1. **URL Encode** → *Shortcut Input*
   2. **Text** → type `https://yesjermo.github.io/subtext-analysis-simulator/web/#take?t=` and then insert the
      **URL Encoded Text** variable right after the `=` (no space)
   3. **Open URLs** → *Text*
5. Tap **Done**.

Now select a message (or several) in any app → **Share** → **Decode with Subtext**. One message
opens decoded; several "Name: text" lines open as a whole chat. Because it falls back to the
clipboard, you can also run it from the Shortcuts widget or with Back Tap (Settings → Accessibility →
Touch → Back Tap) right after copying something.

The shortcut opens Safari rather than the home-screen app; iOS doesn't let links open home-screen web
apps.

## Links other tools can use

| Link | Opens |
|---|---|
| `…/web/#take?t=<text>` | Decided for you: one text is decoded, a "Name: text" chat goes to Read a whole chat |
| `…/web/#decode?t=<text>` | Decode a text. Optional `&after=<your text before it>`, `&app=snapchat`, `&stage=flirting` |
| `…/web/#chat?chat=<"Name: text" lines>` | Read a whole chat |
| `…/web/#library?q=<word or emoji>` | The slang library, searched |

What comes after `#` stays in the browser, and Subtext removes it from the address bar once read.
