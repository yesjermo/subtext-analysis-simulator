/* Subtext engine: reads between the lines of their texts (tone, feelings, subtext, interest,
 * dating stage, ghosting risk) and suggests how to text back.
 *
 * The engine mirrors subtext/decoder.py; both read subtext/data/*.json (bundled into
 * web/data.js by tools/build_web.py). Keep the two in step: on the demo chats and the
 * labelled examples they agree on every reading.
 *
 * window.Subtext = { decodeMessage, decodeChat, findSlang, findEmoji, fmtDelay, meta }
 */
(() => {
  "use strict";
  const D = window.SUBTEXT_DATA;
  if (!D) return;

  const SLANG = D.slang.terms;
  const ORIGINS = D.slang.origins;
  const EMOJI = D.emoji.emoji;
  const PLAY = D.playbook;
  const ORDER = PLAY.order;
  const CATS = PLAY.categories;
  const STAGES = PLAY.stages;
  const PLATFORMS = PLAY.platforms;
  const TYPING = PLAY.typing;
  const TONES = PLAY.tones;
  const TONE_FEELINGS = PLAY.tone_feelings;
  const TONE_GROUPS = Object.fromEntries(Object.entries(PLAY.tone_groups).filter(([k]) => !k.startsWith("_")));
  const GENERATIONS = Object.fromEntries(
    Object.entries(PLAY.generations).filter(([key]) => !key.startsWith("_")),
  );
  const SIGNALS = D.signals.signals.map((signal) => ({
    ...signal,
    rx: new RegExp(signal.pattern, "i"),
  }));

  const EDGE = "[a-z0-9']";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const SLANG_RX = Object.keys(SLANG)
    .map((term) => [
      term,
      new RegExp(`(?:^|(?<!${EDGE}))${esc(term)}(?!${EDGE})`, "gi"),
    ])
    .sort((a, b) => b[0].length - a[0].length);
  const EMOJI_KEYS = Object.keys(EMOJI).sort((a, b) => b.length - a.length);
  const STRETCH = /([a-z])\1{2,}/i;
  const KEYSMASH = /\b(?=[a-z]*[sdfghjkl]{4})[asdfghjkl;]{6,}\b|\b[a-z]*(?:jsjs|ksks|sksk|akdj|fjdk)[a-z]*\b/i;
  const WORD = /[a-z0-9']+/gi;
  const EMOJI_ANY = /[\u{1F300}-\u{1FAFF}☀-➿]/gu;
  const SLOW_MIN = 360, VERY_SLOW_MIN = 1440, FAST_MIN = 5, CONVO_GAP_MIN = 180;

  const words = (t) => t.match(WORD) || [];
  // Python's round(): halves go to the even neighbour, so both engines print the same numbers.
  function pyRound(x, nd = 0) {
    const multiplier = 10 ** nd;
    const value = x * multiplier;
    const floor = Math.floor(value);
    const diff = value - floor;
    const rounded = diff > 0.5 + 1e-9
      ? floor + 1
      : diff < 0.5 - 1e-9
        ? floor
        : floor % 2 === 0
          ? floor
          : floor + 1;
    return rounded / multiplier;
  }
  const clamp = (x, lo = 0, hi = 100) => Math.trunc(Math.max(lo, Math.min(hi, pyRound(x))));
  const level = (s) => (s < 35 ? "low" : s < 60 ? "medium" : "high");
  const interestLabel = (s) => (s >= 80 ? "very into you" : s >= 62 ? "interested" : s >= 45 ? "neutral / unclear" : s >= 30 ? "lukewarm" : "pulling away");
  const normalize = (t) => String(t).trim().replace(/’|‘/g, "'").replace(/“|”/g, '"');
  function fmtDelay(min) {
    if (min < 60) return `${Math.trunc(min)} min`;
    if (min < 48 * 60) return `${(min / 60).toFixed(1)} h`;
    return `${(min / 1440).toFixed(1)} days`;
  }

  // ---------------------------------------------------------------- pieces of one text
  function findSlang(text) {
    const taken = [], hits = [];
    for (const [term, rx] of SLANG_RX) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(text))) {
        const end = m.index + m[0].length, span = [end - term.length, end];
        if (m[0].length === 0) { rx.lastIndex++; continue; }
        if (taken.some(([a, b]) => a < span[1] && span[0] < b)) continue;
        taken.push(span);
        const [meaning, tone, interest, origin] = SLANG[term];
        hits.push({ term, meaning, tone, interest, origin, origin_label: ORIGINS[origin] || origin, at: span[0] });
        break;
      }
    }
    return hits.sort((a, b) => a.at - b.at);
  }

  function findEmoji(text) {
    const hits = [];
    let rest = text;
    for (const e of EMOJI_KEYS) {
      const n = rest.split(e).length - 1;
      if (n) {
        const [meaning, tone, interest] = EMOJI[e];
        hits.push({ emoji: e, count: n, meaning, tone, interest });
        rest = rest.split(e).join(" ");
      }
    }
    return hits;
  }

  // How it was typed. With random emoji, the habits are read from the words alone (a "k" with five unrelated
  // emoji after it is still a short reply with nothing to answer).
  function typingSignals(text, yourLast, delayMin, burst = 1, emojiRandom = false) {
    const full = text.trim();
    const t = emojiRandom ? stripEmoji(full) : full;
    const letters = [...t].filter((c) => /\p{L}/u.test(c));
    const w = words(t);
    const out = [];
    const add = (key, detail) => { const row = { ...TYPING[key], key }; if (detail) row.detail = detail; out.push(row); };
    const qs = (t.match(/\?/g) || []).length;
    if (w.length <= 4 && /[a-z]\.$/i.test(t) && !t.endsWith("..")) add("period_end");
    if (letters.length >= 4 && t.toUpperCase() === t && letters.length) add("all_caps");
    const m = t.match(STRETCH);
    if (m) add("stretched", m[0]);
    if (KEYSMASH.test(t)) add("keysmash");
    if (qs >= 2) add("multi_question");
    else if (qs === 1) add("question");
    else if (w.length <= 2 && !t.match(EMOJI_ANY) && !/\b(wyd|wya|hbu|wbu|hyd|wdym|wym)\b/i.test(t)) add("no_question_short");
    if (w.length >= 25) add("long");
    if (t.includes("!")) add("exclaim");
    if (t.includes("...") || t.includes("…")) add("ellipsis");
    if (w.length >= 5 && /\b(lol|lmao|haha)\s*[.!?]*$/i.test(t)) add("lol_softener");
    if (emojiRandom) add("random_emoji");
    else if ((t.match(EMOJI_ANY) || []).length >= 3) add("emoji_heavy");
    if (burst >= 3) add("burst", `${burst} texts in a row`);
    if (delayMin != null) {
      if (delayMin >= SLOW_MIN) add("slow_reply", fmtDelay(delayMin));
      else if (delayMin <= FAST_MIN) add("fast_reply", fmtDelay(delayMin));
    }
    if (yourLast) {
      const yours = words(yourLast).length;
      if (yours >= 12 && w.length * 4 <= yours) add("shorter_than_you", `you: ${yours} words, them: ${w.length}`);
    }
    return out;
  }

  // The words without the emoji (and their joiners and skin tones), spaces tidied.
  const stripEmoji = (text) => text.replace(EMOJI_ANY, "").replace(/\u200d|\ufe0f/g, "").replace(/\s{2,}/g, " ").trim();

  // A string of unrelated emoji, typed for decoration: four or more different ones, three that pull in
  // different directions (warm, fun, cold), or two or more with no meaning in texting (🦒🚗🌮).
  function emojiRandom(text, emoji) {
    let rest = text;
    for (const e of emoji) rest = rest.split(e.emoji).join(" ");
    const unknown = new Set(rest.match(EMOJI_ANY) || []);
    const distinct = emoji.length + unknown.size;
    const groups = new Set(emoji.filter((e) => e.tone in TONE_GROUPS).map((e) => TONE_GROUPS[e.tone]));
    return distinct >= 4 || (distinct >= 3 && groups.size >= 3) || unknown.size >= 2;
  }

  function generationGuess(text) {
    const low = text.toLowerCase();
    let best = null, bestN = 0, found = [];
    for (const [key, g] of Object.entries(GENERATIONS)) {
      const hits = g.markers.filter((m) => (/^[\x00-\x7f]*$/.test(m)
        ? new RegExp(`(?<!${EDGE})${esc(m)}(?!${EDGE})`).test(low) : text.includes(m)));
      if (hits.length > bestN) { best = key; bestN = hits.length; found = hits; }
    }
    return best ? { key: best, name: GENERATIONS[best].name, markers: found } : null;
  }

  // ---------------------------------------------------------------- one text
  function decodeMessage(raw, { yourLast = null, delayMin = null, hour = null, platform = null, stage = null, burst = 1 } = {}) {
    const text = normalize(raw);
    const slang = findSlang(text), emoji = findEmoji(text);
    // Words first. Emoji only add meaning when they mean something together; a string of random emoji is
    // decoration, and the reading goes by the words.
    const randomEmoji = (emoji.length > 0 || (text.match(EMOJI_ANY) || []).length > 0) && emojiRandom(text, emoji);
    const meaningful = randomEmoji ? [] : emoji;
    const lean = meaningful.reduce((a, e) => a + e.interest, 0);
    const typing = typingSignals(text, yourLast, delayMin, burst, randomEmoji);
    const signals = SIGNALS.filter((s) => s.rx.test(text)).map((s) => ({ ...s }));
    // The words alone too: an emoji after "hey" or "wyd" shouldn't hide what was said.
    const plain = stripEmoji(text);
    if (plain && plain !== text) {
      const found = new Set(signals.map((s) => s.id));
      for (const s of SIGNALS) {
        if (found.has(s.id) || !s.rx.test(plain)) continue;
        if (s.category === "dry" && lean > 0) continue; // "lol 😭" is laughing: the emoji is the answer
        signals.push({ ...s });
      }
    }
    if (hour != null && (hour >= 23 || hour < 4)) {
      for (const s of signals) if (s.id === "wyd" || s.id === "hey_only") { s.implication += " It's late at night, which leans flirty."; s.tone = "flirty"; }
    }

    const votes = {};
    const vote = (k, n) => { votes[k] = (votes[k] || 0) + n; };
    let leadId = null;
    for (const c of ORDER) { const s = signals.find((x) => x.category === c); if (s) { leadId = s.id; break; } }
    // The words decide the tone; emoji set it only when the words don't (or the message is only emoji).
    for (const s of signals) vote(s.tone, s.id === leadId ? 5 : 3);
    for (const h of slang) if (h.tone !== "neutral") vote(h.tone, 1);
    for (const t of typing) if (t.tone !== "neutral" && t.key !== "emoji_heavy") vote(t.tone, 1);
    const fromWords = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    for (const e of meaningful) vote(e.tone, Math.min(e.count, 2));
    for (const t of typing) if (t.key === "emoji_heavy") vote(t.tone, 1); // about the emoji, so it counts with them
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const primary = signals.length || (fromWords.length && fromWords[0][0] !== "neutral")
      ? fromWords[0][0] : (ranked.length ? ranked[0][0] : "neutral");

    // Emoji together nudge interest by one step at most (five 🔥 count as one), none at all when random.
    const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
    const heavy = sum(typing.filter((t) => t.key === "emoji_heavy"), (t) => t.interest);
    const nudges = sum(slang, (h) => h.interest) + Math.max(-1, Math.min(1, lean + heavy))
      + sum(typing.filter((t) => t.key !== "emoji_heavy"), (t) => t.interest);
    const interest = clamp(50 + 8 * sum(signals, (s) => s.interest) + Math.max(-20, Math.min(20, 5 * nudges)), 3, 97);

    let category = ORDER.find((c) => signals.some((s) => s.category === c)) || null;
    const keys = new Set(typing.map((t) => t.key));
    if (!category) {
      if (keys.has("question") || keys.has("multi_question")) category = "question_back";
      else if (keys.has("no_question_short") || keys.has("period_end")) category = "dry";
      else if (primary === "hype") category = "enthusiastic";
      else category = "statement";
    }
    const lead = signals.find((s) => s.category === category) || null;

    const stageVotes = {};
    for (const s of signals) if (s.stage) stageVotes[s.stage] = (stageVotes[s.stage] || 0) + 1 + Math.abs(s.interest);
    if ([...slang, ...meaningful].some((h) => h.tone === "physical")) stageVotes.second_base = (stageVotes.second_base || 0) + 1;
    let detected = null;
    for (const [k, v] of Object.entries(stageVotes)) if (detected === null || v > stageVotes[detected]) detected = k;
    const useStage = stage || detected || "talking";

    const flags = { green: [], yellow: [], red: [] };
    for (const s of signals) if (s.flag) flags[s.flag].push(s.label);

    let risk = 22.0;
    risk += ({ dry: 22, soft_rejection: 32, reengage: 10 })[category] || 0;
    if (keys.has("shorter_than_you")) risk += 14;
    if (keys.has("no_question_short")) risk += 8;
    if (keys.has("period_end")) risk += 8;
    if (delayMin != null) risk += delayMin >= VERY_SLOW_MIN ? 22 : delayMin >= SLOW_MIN ? 12 : delayMin <= FAST_MIN ? -8 : 0;
    if (keys.has("question") || keys.has("multi_question")) risk -= 14;
    if (["invite", "dtr", "exclusivity_probe"].includes(category)) risk -= 18;
    risk -= 4 * flags.green.length;
    risk += (interest - 50) * -0.3;
    const ghost = clamp(risk);
    const reasons = signals.filter((s) => s.interest < 0).map((s) => s.label)
      .concat(typing.filter((t) => t.interest < 0).map((t) => t.label + (t.detail ? ` (${t.detail})` : "")));

    const feelings = [];
    for (const s of signals) if (!feelings.includes(s.feeling)) feelings.push(s.feeling);
    if (!feelings.length) feelings.push(TONE_FEELINGS[primary] || "hard to tell");

    const play = CATS[category];
    const replies = makeReplies(lead && lead.replies ? lead.replies : play.replies, text, emoji);
    const advice = [play.approach];
    const st = STAGES[useStage];
    if (category === "physical_escalation" && play.after_tip) advice.push(play.after_tip);
    if (category === "dtr" && play.if_not_interested) advice.push(`If you don't feel the same: "${play.if_not_interested}"`);
    if (platform && PLATFORMS[platform]) advice.push(...PLATFORMS[platform].notes.slice(0, 2).map((n) => `${PLATFORMS[platform].name}: ${n}`));

    let implications = signals.filter((s) => s.category === category).map((s) => s.implication);
    if (!implications.length) implications = signals.map((s) => s.implication);
    if (!implications.length) implications = [defaultImplication(category, primary, typing)];

    const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]]));
    return {
      text,
      summary: `${TONES[primary] || primary} · ${feelings[0]} · interest ${interest}/100`,
      tone: { primary, label: TONES[primary] || primary, mix: ranked.slice(0, 4).map(([k, v]) => ({ tone: k, label: TONES[k] || k, weight: pyRound(v, 1) })) },
      feelings: feelings.slice(0, 3),
      implications: implications.slice(0, 3),
      category,
      category_name: play.name,
      interest: { score: interest, label: interestLabel(interest) },
      stage: { key: useStage, name: st ? st.name : useStage, detected },
      ghost_risk: { score: ghost, level: level(ghost), reasons },
      flags,
      signals: signals.map((s) => pick(s, ["id", "label", "category", "implication", "feeling", "interest", "stage", "flag"])),
      lead: lead ? lead.label : play.name,
      slang: slang.map((h) => pick(h, ["term", "meaning", "origin", "origin_label"])),
      emoji: emoji.map((e) => pick(e, ["emoji", "meaning", "count"])),
      typing: typing.map((t) => pick(t, ["key", "label", "meaning", "detail"])),
      generation: generationGuess(text),
      goal: play.goal,
      advice,
      replies,
      avoid: play.avoid,
      stage_tips: st ? { do: st.do, dont: st.dont } : null,
    };
  }

  function defaultImplication(category, tone, typing) {
    const keys = new Set(typing.map((t) => t.key));
    if (category === "question_back") return "They asked you something, so they want the conversation to keep going.";
    if (category === "dry") return "Short with nothing to answer. Could be a busy moment; watch whether it becomes a pattern.";
    if (keys.has("long")) return "They put effort into this one; reply with the same effort.";
    return `Reads ${TONES[tone] || tone}. Nothing hidden stands out; respond to what they said and leave a hook.`;
  }

  function makeReplies(options, text, emoji) {
    const short = words(text).length <= 4;
    const order = short ? ["match", "playful", "sincere"] : ["sincere", "playful", "match"];
    const why = {
      match: "Matches their energy and length, so you don't look like you're trying too hard.",
      playful: "Keeps it light and flirty and gives them something fun to answer.",
      sincere: "Says the real thing plainly. Best when the moment matters.",
    };
    const out = [];
    for (const style of order) {
      for (let r of (options[style] || []).slice(0, 2)) {
        if (!emoji.length && style === "match") r = r.replace(EMOJI_ANY, "").replace(/‍|️/g, "").replace(/\s{2,}/g, " ").trim();
        out.push({ style, text: r, why: why[style] });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- a whole chat
  const ts = (m) => { if (!m.timestamp) return null; const d = new Date(m.timestamp); return isNaN(d) ? null : d; };
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  function decodeChat(messages, them, me = null, { platform = null, stage = null, last = null } = {}) {
    const msgs = messages.filter((m) => String(m.text || "").trim());
    const reads = [];
    let yourTurn = [], prev = null, burst = 0;
    msgs.forEach((m, i) => {
      if (m.sender !== them) {
        if (prev && prev.sender === them) yourTurn = [];
        yourTurn.push(m.text); prev = m; burst = 0; return;
      }
      burst += 1;
      let delay = null;
      if (prev && prev.sender !== them) { const a = ts(prev), b = ts(m); if (a && b) delay = Math.max(0, (b - a) / 60000); }
      let run = 1, j = i + 1;
      while (j < msgs.length && msgs[j].sender === them) { run++; j++; }
      const t = ts(m);
      const r = decodeMessage(m.text, {
        yourLast: burst === 1 ? yourTurn.join(" ") : null, delayMin: burst === 1 ? delay : null,
        hour: t ? t.getHours() : null, platform, stage, burst: burst === 1 ? run : 1,
      });
      r.index = i; r.timestamp = m.timestamp || null;
      reads.push(r); prev = m;
    });
    const overview = makeOverview(msgs, reads, them, me, platform, stage);
    return { them, me, messages: last ? reads.slice(-last) : reads, overview };
  }

  function makeOverview(msgs, reads, them, me, platform, stage) {
    if (!reads.length) return { verdict: `No texts from ${them} to read.`, interest: null };
    const theirs = msgs.filter((m) => m.sender === them), yours = msgs.filter((m) => m.sender !== them);
    const scores = reads.map((r) => r.interest.score);
    const third = Math.max(1, Math.floor(scores.length / 3));
    const early = avg(scores.slice(0, third)), late = avg(scores.slice(-third)), trend = late - early;
    const wavg = (ms) => avg(ms.map((m) => words(m.text).length));
    const qrate = (ms) => avg(ms.map((m) => (m.text.includes("?") ? 1 : 0)));
    const effort = { their_words: pyRound(wavg(theirs), 1), your_words: pyRound(wavg(yours), 1),
      their_questions: pyRound(qrate(theirs) * 100), your_questions: pyRound(qrate(yours) * 100) };

    const starts = { them: 0, you: 0 };
    let lastTs = null;
    msgs.forEach((m, k) => {
      const t = ts(m);
      const gap = t && lastTs && (t - lastTs) / 60000 > CONVO_GAP_MIN;
      const prevText = k ? msgs[k - 1].text : "";
      const answering = k > 0 && msgs[k - 1].sender !== m.sender && (prevText.includes("?") || words(prevText).length >= 8);
      if (k === 0 || (gap && !answering)) starts[m.sender === them ? "them" : "you"] += 1;
      lastTs = t || lastTs;
    });

    const delays = { them: [], you: [] };
    for (let k = 1; k < msgs.length; k++) {
      const a = msgs[k - 1], b = msgs[k];
      if (a.sender === b.sender) continue;
      const ta = ts(a), tb = ts(b);
      if (ta && tb) { const d = (tb - ta) / 60000; if (d <= CONVO_GAP_MIN * 8) delays[b.sender === them ? "them" : "you"].push(d); }
    }
    const speed = { them: delays.them.length ? pyRound(median(delays.them), 1) : null, you: delays.you.length ? pyRound(median(delays.you), 1) : null };
    let speedTrend = null;
    if (delays.them.length >= 6) { const h = Math.floor(delays.them.length / 2); speedTrend = pyRound(median(delays.them.slice(h)) - median(delays.them.slice(0, h)), 1); }

    let dry = 0;
    for (let k = reads.length - 1; k >= 0; k--) { if (["dry", "soft_rejection"].includes(reads[k].category)) dry++; else break; }

    const votes = {};
    reads.slice(-20).forEach((r, idx) => { const d = r.stage.detected; if (d) votes[d] = (votes[d] || 0) + idx + 1; });
    let cur = stage;
    if (!cur) { cur = null; for (const [k, v] of Object.entries(votes)) if (cur === null || v > votes[cur]) cur = k; cur = cur || "talking"; }
    if (dry >= 3) cur = "fading";

    const flags = { green: {}, yellow: {}, red: {} };
    for (const r of reads) for (const [c, labels] of Object.entries(r.flags)) for (const l of labels) flags[c][l] = (flags[c][l] || 0) + 1;

    let risk = 25.0;
    risk += Math.max(0, -trend) * 0.8;
    risk -= Math.max(0, trend) * 0.3;
    risk += dry * 9;
    const writesMore = effort.your_words && effort.their_words * 2.2 < effort.your_words;
    if (writesMore) risk += 14;
    if (effort.their_questions + 10 < effort.your_questions) risk += 8;
    const youStart = starts.you >= 3 && starts.them * 3 <= starts.you;
    if (youStart) risk += 12;
    if (speedTrend != null && speedTrend > 60) risk += 10;
    if (speed.them != null && speed.you != null && speed.them > Math.max(60, speed.you * 4)) risk += 8;
    risk -= 6 * Math.min(3, Object.keys(flags.green).length);
    risk += 0.3 * (50 - late);
    if (cur === "fading" || cur === "situationship") risk += 10;
    const ghost = clamp(risk);

    const reasons = [];
    if (trend <= -8) reasons.push(`Their interest has dropped (about ${pyRound(early)} → ${pyRound(late)}).`);
    else if (trend >= 8) reasons.push(`Their interest has gone up (about ${pyRound(early)} → ${pyRound(late)}).`);
    if (dry >= 2) reasons.push(`Their last ${dry} texts were dry or non-committal.`);
    if (writesMore) reasons.push(`You write much more than they do (${effort.your_words} vs ${effort.their_words} words a text).`);
    if (youStart) reasons.push(`You start most conversations (${starts.you} vs ${starts.them}).`);
    else if (starts.them > starts.you) reasons.push(`They start most conversations (${starts.them} vs ${starts.you}), a good sign.`);
    if (speedTrend != null && speedTrend > 60) reasons.push("Their replies are getting slower.");
    if (effort.their_questions >= 30) reasons.push(`They ask a lot of questions (${effort.their_questions}% of their texts).`);

    const lastRead = reads[reads.length - 1], st = STAGES[cur];
    const flagList = (d) => Object.entries(d).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
    return {
      verdict: verdict(late, ghost, cur, flags),
      interest: { now: pyRound(late), start: pyRound(early), trend: pyRound(trend), label: interestLabel(pyRound(late)), series: scores },
      stage: { key: cur, name: st.name, about: st.about, do: st.do, dont: st.dont, watch: st.ghost_risks },
      ghost_risk: { score: ghost, level: level(ghost), reasons },
      effort, starts, reply_minutes: speed, reply_trend_minutes: speedTrend, dry_streak: dry,
      flags: { green: flagList(flags.green), yellow: flagList(flags.yellow), red: flagList(flags.red) },
      next_move: { about: lastRead.text, category: lastRead.category_name, goal: lastRead.goal, advice: lastRead.advice, replies: lastRead.replies, avoid: lastRead.avoid },
      platform: platform ? PLATFORMS[platform] || null : null,
      texts_read: reads.length,
    };
  }

  function verdict(interest, ghost, stage, flags) {
    if (Object.keys(flags.red).length) return "There are red flags here (pressure or control). Put your comfort first; you don't owe anyone a reply.";
    if (stage === "fading" || ghost >= 60) return "It's cooling off. Give one clear, low-pressure opening (ideally a plan), then let them come to you.";
    if (stage === "dtr") return "This is close to official. Don't dodge the 'what are we' moment; say how you feel clearly.";
    if (stage === "second_base") return "Things are getting physical. Keep the pace mutual, check in, and keep texting outside of hookups.";
    if (interest >= 65) return "They're into you. Keep the energy matched and turn it into plans in real life.";
    if (interest >= 45) return "Interest is there but not strong yet. Ask better questions and suggest a low-key plan.";
    return "They're lukewarm. Don't over-invest; match their effort and see if they step up.";
  }

  const meta = { slang: D.slang, emoji: D.emoji, playbook: PLAY, stages: STAGES, platforms: PLATFORMS, demos: D.demos || [] };
  window.Subtext = { decodeMessage, decodeChat, findSlang, findEmoji, fmtDelay, meta };
})();
