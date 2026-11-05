/* Subtext web app: four screens over the engine in engine.js.
 *   #decode   one text: the annotated bubble, interest, ghosting risk, stage, replies, what it means
 *   #chat     a whole chat: interest text by text, effort balance, next move, every text read
 *   #library  every slang word, emoji and phrase the engine knows
 *   #guide    the stages and what each app's habits mean
 * Everything runs in the browser; nothing is sent anywhere.
 */
(() => {
  "use strict";
  const S = window.Subtext;
  const P = window.SubtextParse;
  const M = S.meta;
  const $ = (id) => document.getElementById(id);

  // Build elements without innerHTML, so pasted text is always text.
  function el(tag, attrs = null, ...kids) {
    const n = document.createElement(tag);
    if (typeof attrs === "string") {
      n.className = attrs;
    } else if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") n.className = value;
        else if (key === "text") n.textContent = value;
        else if (key.startsWith("on")) n.addEventListener(key.slice(2), value);
        else n.setAttribute(key, value === true ? "" : value);
      }
    }
    for (const child of kids.flat()) {
      if (child != null && child !== false) {
        n.append(child.nodeType ? child : document.createTextNode(String(child)));
      }
    }
    return n;
  }
  const card = (span, title, meta, ...body) => el(
    "section",
    `card span-${span}`,
    title
      ? el("div", "card-head", el("h2", null, title), meta ? el("span", "meta", meta) : null)
      : null,
    ...body,
  );
  const list = (items, cls = "") => el(
    "ul",
    `list ${cls}`,
    items.map((item) => el("li", null, item)),
  );
  const STYLE = { match: "Match their energy", playful: "Playful", sincere: "Sincere" };
  const TRACK = [["talking", "Talking"], ["flirting", "Flirting"], ["second_base", "Getting physical"], ["dtr", "Official"]];
  const DELAYS = { "": null, fast: 2, normal: 45, slow: 7 * 60, day: 30 * 60 };
  const TRIES = [
    "lowkey deleted my hinge lol",
    "wyd",
    "k.",
    "are we locked in or what",
    "movie night at mine? 😏", // taste-skill-ignore: example texts; the emoji are what gets decoded
    "been so busy lately, maybe another time",
    "stoppp ur making me blush 🙈", // taste-skill-ignore: example text
    "dont be boring just send a pic",
    "hey stranger",
  ]; // taste-skill-ignore: example texts
  const platform = () => $("platform").value || null;

  // ------------------------------------------------------------------ pieces shared by the screens
  function copyButton(text, label = "Copy") {
    const b = el("button", { type: "button", class: "btn ghost", text: label });
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied";       } catch {
        b.textContent = "Couldn't copy";
      }
      setTimeout(() => { b.textContent = label; }, 1400);
    });
    return b;
  }

  function annotated(text) {
    // their text with each decoded word and emoji marked where it sits; the meaning is its tooltip
    const ranges = [];
    for (const h of S.findSlang(text)) {
      ranges.push({ at: h.at, end: h.at + h.term.length, tip: `${h.term}: ${h.meaning}` });
    }
    for (const e of S.findEmoji(text)) {
      let i = text.indexOf(e.emoji);
      while (i >= 0) {
        ranges.push({ at: i, end: i + e.emoji.length, tip: `${e.emoji} ${e.meaning}` });
        i = text.indexOf(e.emoji, i + e.emoji.length);
      }
    }
    ranges.sort((a, b) => a.at - b.at);
    const out = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.at < pos) continue;
      const m = el("mark", { "data-tip": r.tip, tabindex: 0 }, text.slice(r.at, r.end), el("span", "sr-only", ` (${r.tip})`));
      // a word on the right half opens its note leftward, so it stays on screen
      const side = () => m.classList.toggle("tip-end", m.getBoundingClientRect().left > window.innerWidth / 2);
      m.addEventListener("mouseenter", side);
      m.addEventListener("focus", side);
      out.push(text.slice(pos, r.at), m);
      pos = r.end;
    }
    out.push(text.slice(pos));
    return out;
  }

  function pills(flags) {
    const items = [];
    for (const c of ["red", "yellow", "green"]) for (const f of flags[c]) {
      const label = typeof f === "string" ? f : f.label + (f.count > 1 ? ` ×${f.count}` : "");
      items.push(el("span", `pill ${c}`, `${{ red: "Red flag", yellow: "Watch", green: "Good sign" }[c]}: ${label}`));
    }
    return items.length ? el("div", "pills", items) : null;
  }

  function kpiInterest(score, label, note) {
    return el("section", "card span-2 kpi",
      el("span", "k-label", "Interest"),
      el("div", "k-value", el("b", null, score), el("small", null, "/ 100")),
      el("div", { class: "meter", role: "img", "aria-label": `Interest ${score} out of 100` }, el("i", { style: `width:${score}%` })),
      el("span", "k-word", label), note ? el("span", "k-note", note) : null);
  }
  function kpiRisk(r, note) {
    return el("section", "card span-2 kpi",
      el("span", "k-label", "Ghosting risk"),
      el("div", "k-value", el("b", null, r.score), el("small", null, "/ 100")),
      el("div", { class: `meter ${r.level}`, role: "img", "aria-label": `Ghosting risk ${r.score} out of 100, ${r.level}` }, el("i", { style: `width:${Math.max(r.score, 1)}%` })),
      el("span", "k-word", `${r.level[0].toUpperCase()}${r.level.slice(1)}`), note ? el("span", "k-note", note) : null);
  }
  function kpiStage(key, name, note, assumed) {
    const at = TRACK.findIndex(([k]) => k === key);
    const track = el("div", { class: "track", role: "img", "aria-label": at >= 0 ? `Stage ${at + 1} of 4: ${name}` : `${name}, off the track to official` },
      TRACK.map(([, label], i) => el("span", at < 0 ? "" : i < at ? "past" : i === at ? "here" : "", label)));
    return el("section", "card span-2 kpi",
      el("span", "k-label", assumed ? "Stage (assumed)" : "Stage"),
      el("span", "k-word", name), track,
      at < 0 ? el("span", "offtrack", key === "fading" ? "Off the track: it's fading." : "Off the track: no label, no direction.") : null,
      note ? el("span", "k-note", note) : null);
  }

  function replyList(replies, firstOnly) {
    const seen = new Set();
    const main = firstOnly ? replies.filter((r) => !seen.has(r.style) && seen.add(r.style)) : replies;
    const rest = replies.filter((r) => !main.includes(r));
    const box = el("div", "replies", main.map(replyRow));
    if (rest.length) {
      const more = el("button", { type: "button", class: "btn secondary more", text: rest.length === 1 ? "1 more way to say it" : `${rest.length} more ways to say it` });
      more.addEventListener("click", () => { more.replaceWith(...rest.map(replyRow)); });
      box.append(more);
    }
    return box;
  }
  function replyRow(r) {
    return (el("div", "reply",
      el("span", "style", STYLE[r.style]),
      el("div", "body", el("p", "bubble mine", r.text), el("p", "why", r.why)),
      copyButton(r.text)));
  }

  // ------------------------------------------------------------------ Decode a text
  function decode(fromUser) {
    const text = $("theirText").value.trim();
    if (!text) { $("decodeError").hidden = false; $("theirText").setAttribute("aria-invalid", "true"); $("theirText").focus(); return; }
    $("decodeError").hidden = true; $("theirText").removeAttribute("aria-invalid");
    const yours = $("yourText").value.trim();
    const r = S.decodeMessage(text, { yourLast: yours || null, delayMin: DELAYS[$("delay").value], platform: platform(), stage: $("stage").value || null });
    renderReading(r, yours);
    // on a phone the reading starts a screen below the button: take them to it
    if (fromUser && matchMedia("(max-width: 760px)").matches) $("reading").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function renderReading(r, yours) {
    $("decodeFinding").replaceChildren(el("strong", null, r.category_name + ". "), r.implications[0]);
    const box = $("reading");
    box.replaceChildren();
    box.classList.remove("fresh"); void box.offsetWidth; box.classList.add("fresh");

    // the object: their text, decoded in place
    const thread = el("div", "thread",
      yours ? el("p", "bubble mine", el("span", "who", "You"), yours) : null,
      el("p", "bubble", annotated(r.text)),
      el("span", "stamp", r.slang.length + r.emoji.length ? "Tap or hover an underlined word to see what it means." : "No slang or emoji to decode in this one."));
    const side = el("div", "object-side",
      el("h2", null, r.lead),
      el("p", "sub", `${r.tone.label[0].toUpperCase()}${r.tone.label.slice(1)}. They seem ${r.feelings[0]}.`),
      pills(r.flags),
      el("div", "object-actions", copyButton(readingText(r), "Copy the reading")));
    box.append(el("section", "card span-6 object", thread, side));

    // the job, what to send, beside the three numbers that explain it
    box.append(card(4, "Text back", null, el("p", "goal", r.goal), el("p", "sub-h", r.advice[0]), replyList(r.replies, true),
      r.advice.length > 1 ? list(r.advice.slice(1), "quiet") : null));
    box.append(el("div", "span-2 stack",
      kpiInterest(r.interest.score, r.interest.label),
      kpiRisk(r.ghost_risk, r.ghost_risk.reasons[0] || (r.ghost_risk.level === "low" ? "Nothing here says they're pulling away." : null)),
      kpiStage(r.stage.key, r.stage.name, null, !r.stage.detected && !$("stage").value)));

    const decoded = el("dl", "kv",
      r.slang.flatMap((h) => [el("dt", null, h.term), el("dd", null, h.meaning, el("small", null, h.origin_label))]),
      r.emoji.flatMap((e) => [el("dt", "emo", e.emoji), el("dd", null, e.meaning)]),
      r.typing.flatMap((t) => [el("dt", null, t.label), el("dd", null, t.meaning, t.detail ? el("small", null, t.detail) : null)]));
    box.append(card(4, "Between the lines", `${r.slang.length} words · ${r.emoji.length} emoji · ${r.typing.length} typing habits decoded`,
      el("div", "split",
        el("div", "col",
          list(r.implications),
          el("p", "sub-h", "How they probably feel"), el("p", "feel", r.feelings.join(", ")),
          r.generation ? el("p", "sub-h", `Texts like ${r.generation.name}: ${r.generation.markers.join(", ")}`) : null),
        decoded.childElementCount ? decoded : el("p", "empty", "Plain words, no slang, no emoji, nothing unusual in how it was typed."))));
    box.append(card(2, "Avoid", r.stage_tips ? r.stage.name : null, list(r.avoid, "avoid"),
      r.stage_tips ? el("p", "sub-h", `${r.stage.name}: do`) : null, r.stage_tips ? list(r.stage_tips.do, "do") : null));
  }

  function readingText(r) {
    return [`"${r.text}"`, r.summary, `${r.category_name}: ${r.implications[0]}`, `Ghosting risk ${r.ghost_risk.score}/100 (${r.ghost_risk.level})`,
      "Replies:", ...r.replies.map((x) => `- (${x.style}) ${x.text}`)].join("\n");
  }

  // ------------------------------------------------------------------ Read a whole chat
  const chat = { name: null, messages: [], them: null, me: null, source: "", showAll: false, convs: [], conv: 0 };
  const SOURCE_NAME = { instagram: "Instagram", tiktok: "TikTok", snapchat: "Snapchat", sms: "SMS backup", whatsapp: "WhatsApp",
    imessage: "iMessage", text: "pasted chat", csv: "CSV", json: "JSON", screenshots: "screenshots" };

  // An export can hold many conversations: keep them all and show the busiest first.
  function openConversations(convs, emptyNote) {
    const usable = convs.filter((c) => P.participants(c.messages).length >= 2);
    if (!usable.length) {
      $("chatFinding").textContent = convs.length
        ? "Every conversation in there has only one person's messages, so there's nothing of theirs to read. Dating apps and Discord export only your side: use screenshots."
        : emptyNote;
      $("chatBody").replaceChildren();
      return;
    }
    chat.convs = usable;
    $("demoPick").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    openConversation(0);
  }
  function openConversation(i) {
    chat.conv = i;
    const c = chat.convs[i];
    loadChat(c.messages, c.title, c.them, c.me, SOURCE_NAME[c.source] || c.source);
  }

  function loadChat(messages, name, them, me, source) {
    const people = P.participants(messages);
    if (people.length < 2) {
      $("chatFinding").textContent = people.length
        ? `Only ${people[0][0]} is in that chat. Add your side too, each line starting with a name and a colon, like "Me: hiii".`
        : `Couldn't find any messages. Put one per line, starting with a name and a colon, like "Jay: heyyy".`;
      $("chatBody").replaceChildren(); return;
    }
    chat.messages = messages; chat.source = source;
    chat.them = them && people.some(([p]) => p === them) ? them : people[0][0];
    chat.me = me && me !== chat.them ? me : people.find(([p]) => p !== chat.them)[0];
    chat.name = name || chat.them; chat.showAll = false;
    renderChat();
  }

  function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
  const DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

  function renderChat() {
    const res = S.decodeChat(chat.messages, chat.them, chat.me, { platform: platform() });
    const o = res.overview, body = $("chatBody");
    body.replaceChildren();
    if (o.interest == null) { $("chatFinding").textContent = o.verdict; return; }
    $("chatFinding").textContent = o.verdict;

    const stamps = chat.messages.map((m) => m.timestamp).filter(Boolean).map((t) => new Date(t)).filter((d) => !isNaN(d));
    const span = stamps.length ? ` · ${DATE.format(stamps[0])} to ${DATE.format(stamps[stamps.length - 1])}` : "";
    const people = P.participants(chat.messages);
    const whose = el("select", { "aria-label": "Whose texts to read" }, people.map(([p, n]) => el("option", { value: p, selected: p === chat.them }, `Reading ${p} (${n})`)));
    whose.addEventListener("change", () => loadChat(chat.messages, null, whose.value, people.find(([p]) => p !== whose.value)[0], chat.source));
    body.append(el("section", "card span-6",
      el("div", "who-head",
        el("span", { class: "avatar", style: `background:hsl(${hue(chat.them)} 55% 78%)`, "aria-hidden": "true" }, [...chat.them][0].toUpperCase()),
        el("div", null, el("h2", null, chat.name), el("p", null, `${o.texts_read} texts from ${chat.them}, ${chat.messages.length - o.texts_read} from ${chat.me}${span}${chat.source ? ` · ${chat.source}` : ""}`)),
        el("div", "who-tools", chat.convs.length > 1 ? conversationPicker() : null, whose)),
      pills(o.flags.red.length || o.flags.yellow.length || o.flags.green.length
        ? { red: o.flags.red, yellow: o.flags.yellow.slice(0, 3), green: o.flags.green.slice(0, 4) } : { red: [], yellow: [], green: [] })));

    const trendNote = o.interest.trend === 0 ? `Same as at the start (${o.interest.start})` : `${o.interest.trend > 0 ? "Up" : "Down"} from ${o.interest.start} at the start`;
    body.append(kpiInterest(o.interest.now, o.interest.label, trendNote),
      kpiRisk(o.ghost_risk, o.dry_streak >= 2 ? `Their last ${o.dry_streak} texts were dry.` : null),
      kpiStage(o.stage.key, o.stage.name, o.stage.about));

    // interest, text by text, with the biggest single drop named on the chart
    const series = res.messages.map((r) => r.interest.score);
    const labels = res.messages.map((r) => (r.timestamp ? DATE.format(new Date(r.timestamp)) : `#${r.index + 1}`));
    let drop = null;
    for (let i = 1; i < series.length; i++) { const d = series[i] - series[i - 1]; if (d <= -20 && (!drop || d < drop.d)) drop = { i, d }; }
    const plot = el("div", "chart");
    const chartCard = card(4, "Interest, text by text", `${series.length} texts`, plot,
      drop ? el("p", "sub-h", `Biggest drop: "${res.messages[drop.i].text}" (${drop.d} points).`) : null);
    body.append(chartCard);

    const e = o.effort, rm = o.reply_minutes;
    const duo = (label, a, b, fmt) => {
      const max = Math.max(a || 0, b || 0, 1e-9);
      return el("div", "row",
        el("div", null, el("span", null, label), el("span", null, `${fmt(a)} vs ${fmt(b)}`)),
        el("div", "duo", el("i", { class: "them", style: `width:${((a || 0) / max) * 100}%` }), el("i", { class: "you", style: `width:${((b || 0) / max) * 100}%` })));
    };
    const id = (v) => String(v);
    body.append(card(2, "Effort balance", null,
      el("div", "legend", el("span", null, el("i", { style: "background:var(--accent)" }), chat.them), el("span", null, el("i", { style: "background:var(--chart-3)" }), "You")),
      el("div", "effort",
        duo("Words per text", e.their_words, e.your_words, id),
        duo("Texts with a question", e.their_questions, e.your_questions, (v) => `${v}%`),
        duo("Conversations started", o.starts.them, o.starts.you, id),
        rm.them != null && rm.you != null ? duo("Typical reply time", rm.them, rm.you, (v) => (v < 1 ? "under a minute" : S.fmtDelay(v))) : el("p", "sub-h", "No timestamps in this chat, so reply times are left out.")),
      el("p", "effort-read", effortRead(chat.them, e, o.starts))));

    const nm = o.next_move;
    body.append(card(4, "Your next move", nm.category,
      el("p", "sub-h", `Their last text: "${nm.about}"`), el("p", null, nm.goal), replyList(nm.replies, true)));
    body.append(card(2, "What's driving it", null,
      o.ghost_risk.reasons.length ? list(o.ghost_risk.reasons) : el("p", "sub-h", "Nothing stands out either way yet."),
      el("p", "sub-h", `${o.stage.name}: do`), list(o.stage.do, "do"),
      el("p", "sub-h", "Ghosting signs to watch"), list(o.stage.watch, "avoid")));

    // every text, newest first
    const rows = [...res.messages].reverse();
    const shown = chat.showAll ? rows : rows.slice(0, 8);
    const table = el("table", "table",
      el("thead", null, el("tr", null, el("th", null, "Their text"), el("th", "hide-phone", "Kind"), el("th", "hide-phone", "Tone"), el("th", "n", "Interest"), el("th", "n", "Risk"))),
      el("tbody", null, shown.map((r) => {
        const open = () => { $("theirText").value = r.text; $("yourText").value = ""; $("delay").value = ""; location.hash = "#decode"; decode(); };
        const tr = el("tr", { class: "clickable" },
          el("td", "t", el("button", { type: "button", class: "row-open", title: "Decode this text on its own", onclick: (ev) => { ev.stopPropagation(); open(); } }, r.text)), el("td", "hide-phone dim", r.category_name), el("td", "hide-phone dim", r.tone.label),
          el("td", "n", r.interest.score), el("td", "n", el("span", { class: `dot ${r.ghost_risk.level}`, "aria-hidden": "true" }), r.ghost_risk.score));
        tr.addEventListener("click", open);
        return tr;
      })));
    const more = rows.length > 8 ? el("button", { type: "button", class: "btn secondary more", text: chat.showAll ? "Show the latest 8" : `Show all ${rows.length}` }) : null;
    if (more) more.addEventListener("click", () => { chat.showAll = !chat.showAll; renderChat(); });
    body.append(card(6, "Every text, read", "Newest first. Open one to decode it on its own.", table, more));

    // the chart needs its card in the page to measure
    if (window.Charts && series.length > 1) {
      window.Charts.line(plot, {
        labels, series: [{ name: "Interest", values: series }], yTicks: [0, 25, 50, 75, 100], max: 100,
        format: (v) => String(Math.round(v)),
        annotations: drop ? [{ at: drop.i, label: `${drop.d} after "${res.messages[drop.i].text.slice(0, 18)}${res.messages[drop.i].text.length > 18 ? "…" : ""}"` }] : [],
      });
    } else plot.append(el("p", "sub-h", "Only one text from them so far, so there's no trend to draw."));
  }

  // one plain sentence on who is putting in more
  function effortRead(them, e, starts) {
    const words = e.their_words / Math.max(e.your_words, 0.1), asks = e.their_questions - e.your_questions;
    const parts = [];
    if (words < 0.5) parts.push(`You write about ${Math.round(1 / words)}× as much as ${them}`);
    else if (words > 2) parts.push(`${them} writes about ${Math.round(words)}× as much as you`);
    else parts.push(`You and ${them} write about the same amount`);
    if (asks <= -15) parts.push("you ask most of the questions");
    else if (asks >= 15) parts.push(`${them} asks more of the questions`);
    if (starts.them > starts.you * 2 && starts.them >= 3) parts.push(`${them} usually texts first`);
    else if (starts.you > starts.them * 2 && starts.you >= 3) parts.push("you usually text first");
    return parts.join(", ") + ".";
  }

  function conversationPicker() {
    const sel = el("select", { "aria-label": "Which conversation" }, chat.convs.map((c, i) =>
      el("option", { value: i, selected: i === chat.conv }, `${c.title} · ${c.messages.length} texts`)));
    sel.addEventListener("change", () => openConversation(Number(sel.value)));
    return sel;
  }

  function renderDemoPicker() {
    const box = $("demoPick");
    box.replaceChildren(...M.demos.map((d) => {
      const b = el("button", { type: "button", "aria-pressed": "false", title: d.about }, `Demo: ${d.name}`);
      b.addEventListener("click", () => {
        box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        chat.convs = [];
        loadChat(P.parseFile(d.filename, d.text), `${d.name}, ${d.about}`, d.them, d.me, "demo chat");
      });
      return b;
    }));
  }

  // ------------------------------------------------------------------ Slang library
  const lib = { kind: "words" };
  function renderLibrary() {
    const q = $("libSearch").value.trim().toLowerCase(), origin = $("libOrigin").value;
    $("libOrigin").hidden = lib.kind !== "words";
    const lean = (v) => (v > 0 ? el("span", "lean up", v > 1 ? "Into you" : "Warm") : v < 0 ? el("span", "lean down", "Pulling back") : el("span", "lean dim", "Neutral"));
    let rows, head;
    if (lib.kind === "words") {
      head = ["Word", "What it means", "Where it's from", "Leans"];
      rows = Object.entries(M.slang.terms).filter(([t, [m, , , o]]) => (!origin || o === origin) && (!q || t.includes(q) || m.toLowerCase().includes(q)))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([t, [m, , i, o]]) => [el("td", "term", t), el("td", null, m), el("td", "dim hide-phone", M.slang.origins[o] ? M.slang.origins[o].split(/[;(]/)[0].trim() : o), el("td", null, lean(i))]);
    } else if (lib.kind === "emoji") {
      head = ["Emoji", "What it means in a text", "", "Leans"];
      rows = Object.entries(M.emoji.emoji).filter(([e, [m]]) => !q || e.includes(q) || m.toLowerCase().includes(q))
        .map(([e, [m, , i]]) => [el("td", "term emo", e), el("td", null, m), el("td", "hide-phone"), el("td", null, lean(i))]);
    } else {
      head = ["Phrase", "What it usually means", "Kind", "Flag"];
      rows = window.SUBTEXT_DATA.signals.signals.filter((s) => !q || s.label.toLowerCase().includes(q) || s.implication.toLowerCase().includes(q))
        .map((s) => [el("td", "term", s.label), el("td", null, s.implication), el("td", "dim hide-phone", M.playbook.categories[s.category].name),
          el("td", null, s.flag ? el("span", `pill ${s.flag}`, { red: "Red flag", yellow: "Watch", green: "Good sign" }[s.flag]) : el("span", "dim", "None"))]);
    }
    $("libTable").replaceChildren(
      el("thead", null, el("tr", null, head.map((h, i) => el("th", i === 2 ? "hide-phone" : null, h)))),
      el("tbody", null, rows.map((cells) => el("tr", null, cells))));
    $("libCount").textContent = `${rows.length} shown`;
    $("libEmpty").hidden = rows.length > 0;
    if (!rows.length) $("libEmptyText").textContent = q ? `Nothing matches "${$("libSearch").value.trim()}"${origin ? " from there" : ""}. Try what it means instead of how it's spelled.` : "Nothing from there yet.";
    $("libTable").hidden = rows.length === 0;
  }

  // ------------------------------------------------------------------ Stages and apps
  function renderGuide() {
    const order = ["talking", "flirting", "second_base", "dtr", "situationship", "fading"];
    const cards = order.map((k) => {
      const s = M.stages[k];
      return el("section", "card span-2 stage-card",
        el("h2", null, s.name), el("p", "about", s.about),
        el("p", "sub-h", "Do"), list(s.do, "do"), el("p", "sub-h", "Don't"), list(s.dont, "dont"),
        el("p", "sub-h", "Ghosting signs"), list(s.ghost_risks, "avoid"));
    });
    const apps = el("table", "table",
      el("thead", null, el("tr", null, el("th", null, "App"), el("th", null, "What its habits mean"))),
      el("tbody", null, Object.values(M.platforms).map((p) => el("tr", null, el("td", "term", p.name), el("td", null, list(p.notes, "quiet"))))));
    $("guideBody").replaceChildren(...cards, card(6, "What each app's habits mean", "Pick your app in the top bar and every reading adds its notes.", apps));
  }

  // ------------------------------------------------------------------ routing and setup
  const SCREENS = ["decode", "chat", "library", "guide"];
  function route() {
    const [want, query] = location.hash.slice(1).split("?");
    const screen = SCREENS.includes(want) ? want : "decode";
    for (const s of SCREENS) {
      const sec = $(`screen-${s}`), on = s === screen;
      sec.hidden = !on;
      // only the screen on show carries the page's one h1
      const t = sec.querySelector(".screen-title"), tag = on ? "H1" : "H2";
      if (t.tagName !== tag) { const n = el(tag.toLowerCase(), { id: t.id, class: "screen-title" }, t.textContent); t.replaceWith(n); }
    }
    document.querySelectorAll("[data-screen]").forEach((a) => (a.dataset.screen === screen ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    window.scrollTo(0, 0);
    if (query && takeLink(screen, new URLSearchParams(query))) return;
    if (screen === "chat" && !chat.messages.length && !arriving) $("demoPick").querySelector("button").click();
  }

  // Links that arrive with their content: #decode?t=wyd&after=...&app=snapchat&stage=flirting,
  // #chat?chat=<a "Name: text" transcript>, #library?q=rizz. What follows # never reaches a server.
  // The address is then cleaned, so the text doesn't sit in the browser's history.
  function takeLink(screen, q) {
    const clean = () => history.replaceState(null, "", `#${screen}`);
    if (screen === "decode" && q.get("t")) {
      $("theirText").value = q.get("t");
      $("yourText").value = q.get("after") || "";
      $("delay").value = "";
      if (q.get("app") && M.platforms[q.get("app")]) $("platform").value = q.get("app");
      if (q.get("stage") && M.stages[q.get("stage")]) $("stage").value = q.get("stage");
      decode(true); clean(); return true;
    }
    if (screen === "chat" && q.get("chat")) {
      clean(); takeText(q.get("chat"), "chat"); return true;
    }
    if (screen === "library" && q.get("q")) {
      $("libSearch").value = q.get("q"); $("libOrigin").value = "";
      lib.kind = /[a-z0-9]/i.test(q.get("q")) ? "words" : "emoji";
      $("libKind").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kind === lib.kind)));
      renderLibrary(); clean(); return true;
    }
    return false;
  }

  // Whatever someone brings, sent to the screen that fits it: one text is decoded, a whole chat
  // (two or more people) is read on the chat screen, files and screenshots are opened there too.
  let takeFiles = () => {};
  function takeText(raw, prefer) {
    const text = String(raw || "").replace(/\r\n?/g, "\n").trim();
    if (!text) return false;
    let convs = [];
    try { convs = window.SubtextImport.readText("pasted chat.txt", text); } catch { convs = []; }
    const isChat = convs.some((c) => P.participants(c.messages).length >= 2);
    if (isChat) {
      if (location.hash.split("?")[0] !== "#chat") history.pushState(null, "", "#chat");
      showScreen("chat");
      openConversations(convs, "");
      return true;
    }
    if (prefer === "chat") {
      showScreen("chat");
      $("chatPaste").value = text;
      $("pasteBox").hidden = false; $("pasteToggle").setAttribute("aria-expanded", "true");
      $("chatFinding").textContent = `That reads as one person's messages. Add your side, each line starting with a name and a colon, like "Me: hiii".`;
      return true;
    }
    if (location.hash.split("?")[0] !== "#decode") history.pushState(null, "", "#decode");
    showScreen("decode");
    $("theirText").value = text; $("yourText").value = ""; $("delay").value = "";
    decode(true);
    return true;
  }
  // Show a screen without waiting for the hashchange event (pushState doesn't send one).
  let arriving = false; // something is on its way in: don't open a demo chat over it
  function showScreen(screen) {
    if (!$(`screen-${screen}`).hidden) return;
    arriving = true;
    route();
    arriving = false;
  }

  function init() {
    $("platform").append(el("option", { value: "" }, "Any app"), ...Object.entries(M.platforms).map(([k, p]) => el("option", { value: k }, p.name)));
    $("stage").append(el("option", { value: "" }, "Work it out"), ...Object.entries(M.stages).map(([k, s]) => el("option", { value: k }, s.name)));
    $("libOrigin").append(el("option", { value: "" }, "From everywhere"), ...Object.entries(M.slang.origins).map(([k, v]) => el("option", { value: k }, v.split(/[;(]/)[0].trim())));
    $("tries").append(el("span", null, "Try one:"), ...TRIES.map((t) => el("button", { type: "button", class: "try", onclick: () => { $("theirText").value = t; $("yourText").value = ""; decode(true); } }, t)));

    $("theirText").addEventListener("input", () => { if (!$("decodeError").hidden) { $("decodeError").hidden = true; $("theirText").removeAttribute("aria-invalid"); } });
    $("decodeForm").addEventListener("submit", (ev) => { ev.preventDefault(); decode(true); });
    $("theirText").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); decode(true); } });
    $("platform").addEventListener("change", () => { if ($("theirText").value.trim()) decode(); if (chat.messages.length) renderChat(); });

    renderDemoPicker();
    // Chat files and screenshots, one at a time or many, or a whole export folder.
    const openFiles = async (fileList) => {
      const files = [...fileList];
      if (!files.length) return;
      const images = files.filter((f) => window.SubtextShots && window.SubtextShots.IMAGE_RE.test(f.name));
      const texts = files.filter((f) => /\.(json|xml|txt|csv)$/i.test(f.name));
      try {
        if (texts.length) {
          openConversations(await window.SubtextImport.readFiles(texts),
            "No messages in there. Check it's the right file: see How to get your chats.");
        } else if (images.length) {
          await readShots(images);
        } else {
          $("chatFinding").textContent = "Subtext opens .json, .xml, .txt and .csv chat files, and screenshots.";
        }
      } catch (err) {
        $("chatFinding").textContent = `Couldn't read that: ${err.message}`;
      }
    };
    // Screenshots are read on this device, then shown as text to check before decoding: OCR misreads words.
    const readShots = async (images) => {
      const progress = (note) => { if (note) $("chatFinding").textContent = note; };
      const msgs = await window.SubtextShots.read(images, progress, "Them", "Me");
      if (!msgs.length) {
        $("chatFinding").textContent = "Couldn't find chat bubbles in those screenshots. Crop out anything that isn't the chat and try again.";
        return;
      }
      $("chatPaste").value = msgs.map((m) => `${m.sender}: ${m.text}`).join("\n");
      $("pasteLabel").textContent = "Check what was read from the screenshots: fix any misread words, and swap \"Them\" for their name if you like";
      $("pasteBox").hidden = false; $("pasteToggle").setAttribute("aria-expanded", "true");
      $("chatFinding").textContent = `Read ${msgs.length} bubbles from ${images.length} screenshot${images.length === 1 ? "" : "s"}. Check the text below, then press Read this chat.`;
      $("chatPaste").focus();
    };
    takeFiles = (files) => {
      if (location.hash.split("?")[0] !== "#chat") history.pushState(null, "", "#chat");
      showScreen("chat");
      return openFiles(files);
    };

    // Paste anywhere. In a text field a plain paste stays a normal paste; a screenshot or file is always taken.
    document.addEventListener("paste", (ev) => {
      const data = ev.clipboardData;
      if (!data) return;
      const files = [...data.files];
      if (files.length) { ev.preventDefault(); takeFiles(files); return; }
      if (ev.target.closest && ev.target.closest("input, textarea, select, [contenteditable]")) return;
      const text = data.getData("text/plain");
      if (text.trim()) { ev.preventDefault(); takeText(text); }
    });

    // Drop anywhere: files, screenshots, or dragged text.
    const veil = $("dropVeil");
    let dragDepth = 0;
    const carriesSomething = (ev) => [...(ev.dataTransfer?.types || [])].some((t) => t === "Files" || t === "text/plain");
    document.addEventListener("dragenter", (ev) => { if (!carriesSomething(ev)) return; dragDepth++; veil.hidden = false; });
    document.addEventListener("dragover", (ev) => { if (carriesSomething(ev)) ev.preventDefault(); });
    document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) veil.hidden = true; });
    document.addEventListener("drop", (ev) => {
      dragDepth = 0; veil.hidden = true;
      if (ev.target.closest && ev.target.closest("textarea, input")) return; // dropping words into a field: let it
      if (!carriesSomething(ev)) return;
      ev.preventDefault();
      const files = [...ev.dataTransfer.files];
      if (files.length) takeFiles(files);
      else takeText(ev.dataTransfer.getData("text/plain"));
    });

    // One tap on a phone, where there's no keyboard shortcut to paste.
    if (navigator.clipboard && (navigator.clipboard.read || navigator.clipboard.readText)) {
      $("clipBtn").hidden = false;
      $("clipBtn").addEventListener("click", async () => {
        try {
          if (navigator.clipboard.read) {
            const files = [];
            let text = "";
            for (const item of await navigator.clipboard.read()) {
              const image = item.types.find((t) => t.startsWith("image/"));
              if (image) files.push(new File([await item.getType(image)], `clipboard.${image.split("/")[1]}`, { type: image }));
              else if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text();
            }
            if (files.length) { takeFiles(files); return; }
            if (takeText(text)) return;
          } else if (takeText(await navigator.clipboard.readText())) return;
          $("decodeFinding").textContent = "Your clipboard is empty. Copy their text, a whole chat or a screenshot first.";
        } catch {
          $("decodeFinding").textContent = "This browser didn't let Subtext read the clipboard. Paste with Ctrl+V or ⌘V, or long-press the box and choose Paste.";
        }
      });
    }

    $("chatFile").addEventListener("change", (ev) => { const f = ev.target.files; openFiles(f).finally(() => { ev.target.value = ""; }); });
    $("chatFolder").addEventListener("change", (ev) => { const f = ev.target.files; openFiles(f).finally(() => { ev.target.value = ""; }); });
    $("guideToggle").addEventListener("click", () => {
      const open = $("getGuide").hidden;
      $("getGuide").hidden = !open; $("guideToggle").setAttribute("aria-expanded", String(open));
    });
    $("pasteToggle").addEventListener("click", () => {
      const open = $("pasteBox").hidden;
      $("pasteBox").hidden = !open; $("pasteToggle").setAttribute("aria-expanded", String(open));
      if (open) $("chatPaste").focus();
    });
    $("pasteBox").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const [c] = window.SubtextImport.readText("pasted chat.txt", $("chatPaste").value);
      chat.convs = [];
      $("demoPick").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      loadChat(c ? c.messages : [], null, c && c.them, c && c.me, "pasted chat");
    });

    $("libSearch").addEventListener("input", renderLibrary);
    $("libClear").addEventListener("click", () => { $("libSearch").value = ""; $("libOrigin").value = ""; renderLibrary(); $("libSearch").focus(); });
    $("libOrigin").addEventListener("change", renderLibrary);
    $("libKind").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      lib.kind = b.dataset.kind;
      $("libKind").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderLibrary();
    }));
    const words = Object.keys(M.slang.terms).length, emoji = Object.keys(M.emoji.emoji).length, phrases = window.SUBTEXT_DATA.signals.signals.length;
    $("libFinding").textContent = `${words} words, ${emoji} emoji and ${phrases} phrases, with what they mean when someone texts them to you.`;
    $("lookupForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const q = $("lookup").value.trim();
      const isEmoji = q && !/[a-z0-9]/i.test(q);
      lib.kind = isEmoji ? "emoji" : "words";
      $("libKind").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kind === lib.kind)));
      $("libSearch").value = q; $("libOrigin").value = "";
      location.hash = "#library"; renderLibrary();
    });

    const narrow = matchMedia("(max-width: 760px)");
    const hint = () => { $("lookup").placeholder = narrow.matches ? "Look up a word" : "Look up a word or emoji: rizz, delulu, 💀"; }; // taste-skill-ignore: an emoji you can look up
    hint(); narrow.addEventListener("change", hint);

    renderLibrary();
    renderGuide();
    $("theirText").value = TRIES[0];
    decode();
    window.addEventListener("hashchange", route);
    route();
  }

  init();
})();
