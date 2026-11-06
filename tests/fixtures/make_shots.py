"""Draw mock chat screens in the layout of each app and screenshot them at phone resolution.

  python3 tests/fixtures/make_shots.py          (needs Microsoft Edge or Google Chrome on macOS)

Each screen holds the same fictional conversation, so the reader can be scored against it:
tests/fixtures/shots/expected.json. These are drawings of the layouts, not real screenshots.
"""
import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent / "shots"
CONVO = [  # (who, text): "them" is Alex, "me" is you
    ("them", "hey stranger"),
    ("them", "been a minute huh"),
    ("me", "omg hiii how have you been"),
    ("them", "good!! wanna get coffee this week?"),
    ("me", "yes! saturday?"),
    ("them", "perfect see u then"),
]
BROWSERS = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]

BASE = """<!doctype html><meta charset=utf-8><style>
*{box-sizing:border-box} body{margin:0;width:390px;height:844px;overflow:hidden;font:16px/1.3 -apple-system,Helvetica,Arial;display:flex;flex-direction:column}
header{height:96px;display:flex;align-items:flex-end;gap:10px;padding:0 16px 12px} header b{font-size:17px} header small{display:block;font-size:12px;opacity:.6}
main{flex:1;padding:12px;display:flex;flex-direction:column;gap:6px} footer{height:90px;display:flex;align-items:center;padding:0 16px;opacity:.6}
.row{display:flex;align-items:flex-end;gap:8px} .row.me{justify-content:flex-end}
.b{max-width:72%%;padding:9px 13px;border-radius:20px} .av{width:28px;height:28px;border-radius:50%%;flex:none}
.c{align-self:center;font-size:12px;opacity:.6;margin:6px 0} %s</style>%s"""


def bubbles(convo, avatar=False, extra=""):
    out = []
    for i, (who, text) in enumerate(convo):
        last_of_run = i + 1 == len(convo) or convo[i + 1][0] != who
        av = '<span class="av"></span>' if avatar and who == "them" else ""
        if avatar and who == "them" and not last_of_run:
            av = '<span class="av" style="visibility:hidden"></span>'
        out.append(f'<div class="row {who}">{av}<div class="b {who}">{text}{extra if who else ""}</div></div>')
    return "".join(out)


def screens():
    s = {}
    s["imessage-light"] = ("body{background:#fff;color:#000} header{justify-content:center;border-bottom:1px solid #ddd}"
        ".b.them{background:#e9e9eb}.b.me{background:#0a84ff;color:#fff} footer{border-top:1px solid #ddd}",
        f'<header><b>Alex</b></header><main><div class="c">Today 9:41 PM</div>{bubbles(CONVO)}<div class="c" style="align-self:flex-end">Read 9:52 PM</div></main><footer>iMessage</footer>')
    s["instagram-dark"] = ("body{background:#000;color:#fff} .av{background:#b98}.b.them{background:#262626}.b.me{background:#7a3cf5;color:#fff}",
        f'<header><span class="av" style="width:36px;height:36px"></span><div><b>alex.rivera</b><small>Active now</small></div></header>'
        f'<main><div class="c">Today 9:41 PM</div>{bubbles(CONVO, avatar=True)}<div class="c" style="align-self:flex-end">Seen</div></main><footer>Message...</footer>')
    s["whatsapp-light"] = ("body{background:#efeae2;color:#111} header{background:#f0f2f5} .b{border-radius:8px;padding:6px 9px 4px}"
        ".b.them{background:#fff}.b.me{background:#d9fdd3} .t{font-size:11px;opacity:.55;margin-left:10px;float:right;margin-top:6px}"
        ".c{background:#fff;padding:4px 10px;border-radius:8px;opacity:.8} footer{background:#f0f2f5}",
        '<header><span class="av" style="width:36px;height:36px;background:#9ab"></span><div><b>Alex</b><small>online</small></div></header>'
        '<main><div class="c">TODAY</div>' + "".join(
            f'<div class="row {w}"><div class="b {w}">{t}<span class="t">9:{41 + i} PM{" ✓✓" if w == "me" else ""}</span></div></div>'
            for i, (w, t) in enumerate(CONVO)) + '</main><footer>Message</footer>')
    s["hinge-light"] = ("body{background:#fff;color:#000} header{justify-content:center;border-bottom:1px solid #eee}"
        ".b.them{background:#f1f1f1}.b.me{background:#000;color:#fff}",
        f'<header><b>Alex</b></header><main><div class="c">Matched on Nov 3</div>{bubbles(CONVO)}</main><footer>Send a message</footer>')
    s["tiktok-dark"] = ("body{background:#121212;color:#fff} .av{background:#6a8}.b{border-radius:12px}.b.them{background:#2f2f2f}.b.me{background:#20d5ec;color:#000}",
        f'<header style="justify-content:center"><b>alexrivera</b></header><main><div class="c">9:41 PM</div>{bubbles(CONVO, avatar=True)}</main><footer>Send a message...</footer>')
    # Snapchat: no bubbles. A coloured name above each run, a coloured bar beside the words, all on the left.
    snap = []
    for i, (w, t) in enumerate(CONVO):
        if i == 0 or CONVO[i - 1][0] != w:
            snap.append(f'<div class="who {w}">{"ME" if w == "me" else "ALEX"}</div>')
        snap.append(f'<div class="m {w}">{t}</div>')
    s["snapchat-light"] = ("body{background:#fff;color:#000} header{justify-content:center;border-bottom:1px solid #eee} main{gap:2px}"
        ".who{font-size:12px;font-weight:700;margin-top:10px}.who.me{color:#f23c57}.who.them{color:#0eadff}"
        ".m{border-left:2px solid;padding:2px 10px}.m.me{border-color:#f23c57}.m.them{border-color:#0eadff}",
        f'<header><b>Alex</b></header><main>{"".join(snap)}</main><footer>Send a chat</footer>')
    # Discord: avatar, name and time, then the messages under it, everything on the left.
    disc = []
    for i, (w, t) in enumerate(CONVO):
        if i == 0 or CONVO[i - 1][0] != w:
            name = "riley" if w == "me" else "alex"
            disc.append(f'<div class="hd"><span class="av" style="width:36px;height:36px;background:{"#5865f2" if w == "me" else "#e67"}"></span>'
                        f'<b>{name}</b><small>Today at 9:{41 + i} PM</small></div>')
        disc.append(f'<div class="m">{t}</div>')
    s["discord-dark"] = ("body{background:#313338;color:#dbdee1} header{border-bottom:1px solid #222} main{gap:2px}"
        ".hd{display:flex;align-items:center;gap:10px;margin-top:12px}.hd b{color:#fff}.hd small{font-size:12px;opacity:.6}.m{padding-left:46px}",
        f'<header><b># alex</b></header><main>{"".join(disc)}</main><footer>Message @alex</footer>')
    return s


def main():
    browser = next((b for b in BROWSERS if Path(b).exists()), None)
    if not browser:
        raise SystemExit("Needs Microsoft Edge or Google Chrome.")
    HERE.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, (css, body) in screens().items():
            page = Path(tmp) / f"{name}.html"
            page.write_text(BASE % (css, body), encoding="utf-8")
            subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=3",
                            "--window-size=390,844", f"--screenshot={HERE / (name + '.png')}", page.as_uri()],
                           capture_output=True, check=False)
            print("wrote", name)
    expected = {"them": "Alex", "convo": [{"side": "left" if w == "them" else "right", "text": t} for w, t in CONVO]}
    (HERE / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


if __name__ == "__main__":
    main()
