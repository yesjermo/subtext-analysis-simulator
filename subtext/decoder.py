"""Read between the lines of a text: tone, feelings, subtext, interest, dating stage, ghosting
risk, and how to text back.

  decode_message("lowkey deleted my hinge lol")   -> one text, read on its own
  decode_chat(messages, them="Sam", me="Riley")   -> every text of theirs, plus the overall picture

Everything it knows lives in subtext/data/*.json (slang, emoji, subtext signals, the reply playbook,
dating stages and platforms), shared with web/engine.js through web/data.js. It's a rule-based
reading, made to explain itself: every conclusion lists the words or habits it came from.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from statistics import median

from .chat_parser import Message

DATA_DIR = Path(__file__).with_name("data")


def load_data() -> dict:
    out = {}
    for name in ("slang", "emoji", "signals", "playbook"):
        out[name] = json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return out


DATA = load_data()
SLANG: dict[str, list] = DATA["slang"]["terms"]
ORIGINS: dict[str, str] = DATA["slang"]["origins"]
EMOJI: dict[str, list] = DATA["emoji"]["emoji"]
PLAY = DATA["playbook"]
ORDER: list[str] = PLAY["order"]
CATS: dict[str, dict] = PLAY["categories"]
STAGES: dict[str, dict] = PLAY["stages"]
PLATFORMS: dict[str, dict] = PLAY["platforms"]
TYPING: dict[str, dict] = PLAY["typing"]
TONES: dict[str, str] = PLAY["tones"]
TONE_FEELINGS: dict[str, str] = PLAY["tone_feelings"]
GENERATIONS = {k: v for k, v in PLAY["generations"].items() if not k.startswith("_")}
SIGNALS = [dict(s, rx=re.compile(s["pattern"], re.I)) for s in DATA["signals"]["signals"]]

_EDGE = r"[a-z0-9']"
SLANG_RX = sorted(
    ((term, re.compile(rf"(?:^|(?<!{_EDGE})){re.escape(term)}(?!{_EDGE})", re.I)) for term in SLANG),
    key=lambda t: -len(t[0]),
)
EMOJI_KEYS = sorted(EMOJI, key=len, reverse=True)
STRETCH = re.compile(r"([a-z])\1{2,}", re.I)
KEYSMASH = re.compile(r"\b(?=[a-z]*[sdfghjkl]{4})[asdfghjkl;]{6,}\b|\b[a-z]*(?:jsjs|ksks|sksk|akdj|fjdk)[a-z]*\b", re.I)
WORD = re.compile(r"[a-z0-9']+", re.I)
EMOJI_ANY = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
SLOW_MIN = 6 * 60
VERY_SLOW_MIN = 24 * 60
FAST_MIN = 5
CONVO_GAP_MIN = 3 * 60


def normalize(text: str) -> str:
    """Curly quotes from iPhones become straight ones so "I’m" matches like "I'm"."""
    return text.strip().replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')


def _clamp(x: float, lo: int = 0, hi: int = 100) -> int:
    return int(max(lo, min(hi, round(x))))


def _level(score: int) -> str:
    return "low" if score < 35 else "medium" if score < 60 else "high"


def _interest_label(score: int) -> str:
    if score >= 80:
        return "very into you"
    if score >= 62:
        return "interested"
    if score >= 45:
        return "neutral / unclear"
    if score >= 30:
        return "lukewarm"
    return "pulling away"


# ---- the pieces of one text ------------------------------------------------------

def find_slang(text: str) -> list[dict]:
    """Slang in the text, longest match first ('no cap' wins over 'cap')."""
    taken: list[tuple[int, int]] = []
    hits = []
    for term, rx in SLANG_RX:
        for m in rx.finditer(text):
            span = (m.end() - len(term), m.end())
            if any(a < span[1] and span[0] < b for a, b in taken):
                continue
            taken.append(span)
            meaning, tone, interest, origin = SLANG[term]
            hits.append(
                {
                    "term": term,
                    "meaning": meaning,
                    "tone": tone,
                    "interest": interest,
                    "origin": origin,
                    "origin_label": ORIGINS.get(origin, origin),
                    "at": span[0],
                }
            )
            break
    return sorted(hits, key=lambda h: h["at"])


def find_emoji(text: str) -> list[dict]:
    hits, rest = [], text
    for e in EMOJI_KEYS:
        n = rest.count(e)
        if n:
            meaning, tone, interest = EMOJI[e]
            hits.append(
                {
                    "emoji": e,
                    "count": n,
                    "meaning": meaning,
                    "tone": tone,
                    "interest": interest,
                }
            )
            rest = rest.replace(e, " ")
    return hits


def typing_signals(
    text: str,
    your_last: str | None = None,
    delay_min: float | None = None,
    burst: int = 1,
) -> list[dict]:
    t = text.strip()
    letters = [c for c in t if c.isalpha()]
    words = WORD.findall(t)
    out = []

    def add(key: str, detail: str = "") -> None:
        row = dict(TYPING[key], key=key)
        if detail:
            row["detail"] = detail
        out.append(row)

    qs = t.count("?")
    if len(words) <= 4 and re.search(r"[a-z]\.$", t, re.I) and not t.endswith(".."):
        add("period_end")
    if len(letters) >= 4 and t.upper() == t and any(c.isalpha() for c in t):
        add("all_caps")
    m = STRETCH.search(t)
    if m:
        add("stretched", m.group(0))
    if KEYSMASH.search(t):
        add("keysmash")
    if qs >= 2:
        add("multi_question")
    elif qs == 1:
        add("question")
    elif (
        len(words) <= 2
        and not EMOJI_ANY.search(t)
        and not re.search(r"\b(wyd|wya|hbu|wbu|hyd|wdym|wym)\b", t, re.I)
    ):
        add("no_question_short")
    if len(words) >= 25:
        add("long")
    if "!" in t:
        add("exclaim")
    if "..." in t or "…" in t:
        add("ellipsis")
    if len(words) >= 5 and re.search(r"\b(lol|lmao|haha)\s*[.!?]*$", t, re.I):
        add("lol_softener")
    if len(EMOJI_ANY.findall(t)) >= 3:
        add("emoji_heavy")
    if burst >= 3:
        add("burst", f"{burst} texts in a row")
    if delay_min is not None:
        if delay_min >= SLOW_MIN:
            add("slow_reply", _fmt_delay(delay_min))
        elif delay_min <= FAST_MIN:
            add("fast_reply", _fmt_delay(delay_min))
    if your_last:
        yours = len(WORD.findall(your_last))
        if yours >= 12 and len(words) * 4 <= yours:
            add("shorter_than_you", f"you: {yours} words, them: {len(words)}")
    return out


def _fmt_delay(minutes: float) -> str:
    if minutes < 60:
        return f"{int(minutes)} min"
    if minutes < 48 * 60:
        return f"{minutes / 60:.1f} h"
    return f"{minutes / 1440:.1f} days"


def generation_guess(text: str) -> dict | None:
    low = text.lower()
    best, best_n, found = None, 0, []
    for key, g in GENERATIONS.items():
        hits = [
            marker
            for marker in g["markers"]
            if (
                marker in text
                if not marker.isascii()
                else re.search(rf"(?<!{_EDGE}){re.escape(marker)}(?!{_EDGE})", low)
            )
        ]
        if len(hits) > best_n:
            best, best_n, found = key, len(hits), hits
    if not best:
        return None
    return {"key": best, "name": GENERATIONS[best]["name"], "markers": found}


# ---- one text -------------------------------------------------------------------

def decode_message(
    text: str,
    *,
    your_last: str | None = None,
    delay_min: float | None = None,
    hour: int | None = None,
    platform: str | None = None,
    stage: str | None = None,
    burst: int = 1,
) -> dict:
    """Read one of their texts. your_last is what you sent right before (for effort balance),
    delay_min how long they took to answer, hour the local hour they sent it (0-23)."""
    text = normalize(text)
    slang = find_slang(text)
    emoji = find_emoji(text)
    typing = typing_signals(text, your_last, delay_min, burst)
    signals = [dict(s) for s in SIGNALS if s["rx"].search(text)]
    if hour is not None and (hour >= 23 or hour < 4):
        for s in signals:
            if s["id"] in ("wyd", "hey_only"):
                s["implication"] += " It's late at night, which leans flirty."
                s["tone"] = "flirty"

    # Tone: signals count most, then emoji, then slang and typing habits.
    votes: dict[str, float] = {}
    lead_id = next((s["id"] for c in ORDER for s in signals if s["category"] == c), None)
    for s in signals:
        votes[s["tone"]] = votes.get(s["tone"], 0) + (5 if s["id"] == lead_id else 3)
    for e in emoji:
        votes[e["tone"]] = votes.get(e["tone"], 0) + 2 * min(e["count"], 2)
    for h in slang:
        if h["tone"] != "neutral":
            votes[h["tone"]] = votes.get(h["tone"], 0) + 1
    for ty in typing:
        if ty["tone"] != "neutral":
            votes[ty["tone"]] = votes.get(ty["tone"], 0) + 1
    ranked = sorted(votes.items(), key=lambda kv: -kv[1])
    primary = ranked[0][0] if ranked else "neutral"

    # Interest: 50 is "can't tell". Signals move it most; slang/emoji/typing are capped nudges.
    nudges = sum(h["interest"] for h in slang) + sum(e["interest"] for e in emoji) + sum(t["interest"] for t in typing)
    score = 50 + 8 * sum(s["interest"] for s in signals) + max(-20, min(20, 5 * nudges))
    interest = _clamp(score, 3, 97)

    category = next((c for c in ORDER if any(s["category"] == c for s in signals)), None)
    if not category:
        keys = {t["key"] for t in typing}
        if keys & {"question", "multi_question"}:
            category = "question_back"
        elif "no_question_short" in keys or "period_end" in keys:
            category = "dry"
        elif primary in ("hype",):
            category = "enthusiastic"
        else:
            category = "statement"
    lead = next((s for s in signals if s["category"] == category), None)

    stage_votes: dict[str, float] = {}
    for s in signals:
        if s["stage"]:
            stage_votes[s["stage"]] = stage_votes.get(s["stage"], 0) + 1 + abs(s["interest"])
    if any(h["tone"] == "physical" for h in slang + emoji):
        stage_votes["second_base"] = stage_votes.get("second_base", 0) + 1
    detected = max(stage_votes, key=stage_votes.get) if stage_votes else None
    use_stage = stage or detected or "talking"

    flags = {"green": [], "yellow": [], "red": []}
    for s in signals:
        if s["flag"]:
            flags[s["flag"]].append(s["label"])

    # Ghosting risk for this one text.
    keys = {t["key"] for t in typing}
    risk = 22.0
    risk += {"dry": 22, "soft_rejection": 32, "reengage": 10}.get(category, 0)
    risk += 14 if "shorter_than_you" in keys else 0
    risk += 8 if "no_question_short" in keys else 0
    risk += 8 if "period_end" in keys else 0
    if delay_min is not None:
        risk += 22 if delay_min >= VERY_SLOW_MIN else 12 if delay_min >= SLOW_MIN else -8 if delay_min <= FAST_MIN else 0
    risk -= 14 if keys & {"question", "multi_question"} else 0
    risk -= 18 if category in ("invite", "dtr", "exclusivity_probe") else 0
    risk -= 4 * len(flags["green"])
    risk += (interest - 50) * -0.3
    ghost = _clamp(risk)
    reasons = [s["label"] for s in signals if s["interest"] < 0]
    reasons += [t["label"] + (f" ({t['detail']})" if t.get("detail") else "") for t in typing if t["interest"] < 0]

    feelings = []
    for s in signals:
        if s["feeling"] not in feelings:
            feelings.append(s["feeling"])
    if not feelings:
        feelings.append(TONE_FEELINGS.get(primary, "hard to tell"))

    play = CATS[category]
    replies = _replies(lead["replies"] if lead and lead.get("replies") else play["replies"], text, emoji)
    advice = [play["approach"]]
    st = STAGES.get(use_stage)
    if category == "physical_escalation" and play.get("after_tip"):
        advice.append(play["after_tip"])
    if category == "dtr" and play.get("if_not_interested"):
        advice.append(f"If you don't feel the same: \"{play['if_not_interested']}\"")
    if platform and platform in PLATFORMS:
        advice += [f"{PLATFORMS[platform]['name']}: {n}" for n in PLATFORMS[platform]["notes"][:2]]

    implications = [s["implication"] for s in signals if s["category"] == category] or [s["implication"] for s in signals]
    if not implications:
        implications = [_default_implication(category, primary, typing)]

    return {
        "text": text,
        "summary": f"{TONES.get(primary, primary)} · {feelings[0]} · interest {interest}/100",
        "tone": {"primary": primary, "label": TONES.get(primary, primary),
                 "mix": [{"tone": k, "label": TONES.get(k, k), "weight": round(v, 1)} for k, v in ranked[:4]]},
        "feelings": feelings[:3],
        "implications": implications[:3],
        "category": category,
        "category_name": play["name"],
        "interest": {"score": interest, "label": _interest_label(interest)},
        "stage": {"key": use_stage, "name": st["name"] if st else use_stage, "detected": detected},
        "ghost_risk": {"score": ghost, "level": _level(ghost), "reasons": reasons},
        "flags": flags,
        "signals": [{k: s[k] for k in ("id", "label", "category", "implication", "feeling", "interest", "stage", "flag")} for s in signals],
        "lead": lead["label"] if lead else play["name"],
        "slang": [{k: h[k] for k in ("term", "meaning", "origin", "origin_label")} for h in slang],
        "emoji": [{k: e[k] for k in ("emoji", "meaning", "count")} for e in emoji],
        "typing": [{k: t[k] for k in ("key", "label", "meaning") if k in t} | ({"detail": t["detail"]} if t.get("detail") else {}) for t in typing],
        "generation": generation_guess(text),
        "goal": play["goal"],
        "advice": advice,
        "replies": replies,
        "avoid": play["avoid"],
        "stage_tips": {"do": st["do"], "dont": st["dont"]} if st else None,
    }


def _default_implication(category: str, tone: str, typing: list[dict]) -> str:
    keys = {t["key"] for t in typing}
    if category == "question_back":
        return "They asked you something, so they want the conversation to keep going."
    if category == "dry":
        return "Short with nothing to answer. Could be a busy moment; watch whether it becomes a pattern."
    if "long" in keys:
        return "They put effort into this one; reply with the same effort."
    return f"Reads {TONES.get(tone, tone)}. Nothing hidden stands out; respond to what they said and leave a hook."


def _replies(options: dict, text: str, emoji: list[dict]) -> list[dict]:
    """Three ways to answer. Lead with matching their energy when they were brief."""
    short = len(WORD.findall(text)) <= 4
    order = ["match", "playful", "sincere"] if short else ["sincere", "playful", "match"]
    why = {
        "match": "Matches their energy and length, so you don't look like you're trying too hard.",
        "playful": "Keeps it light and flirty and gives them something fun to answer.",
        "sincere": "Says the real thing plainly. Best when the moment matters.",
    }
    uses_emoji = bool(emoji)
    out = []
    for style in order:
        for r in options.get(style, [])[:2]:
            if not uses_emoji and style == "match":  # don't add emoji they didn't use
                r = re.sub(r"\s{2,}", " ", EMOJI_ANY.sub("", r).replace("\u200d", "").replace("\ufe0f", "")).strip()
            out.append({"style": style, "text": r, "why": why[style]})
    return out


# ---- a whole chat --------------------------------------------------------------

def _ts(m: Message) -> datetime | None:
    if not m.timestamp:
        return None
    try:
        return datetime.fromisoformat(m.timestamp.replace("Z", "+00:00"))
    except ValueError:
        return None


def decode_chat(messages: list[Message], them: str, me: str | None = None, *, platform: str | None = None,
                stage: str | None = None, last: int | None = None) -> dict:
    """Read every text from `them`, then judge the conversation as a whole."""
    msgs = [m for m in messages if m.text.strip()]
    reads = []
    your_turn: list[str] = []
    prev: Message | None = None
    burst = 0
    for i, m in enumerate(msgs):
        if m.sender != them:
            if prev is not None and prev.sender == them:
                your_turn = []
            your_turn.append(m.text)
            prev = m
            burst = 0
            continue
        burst += 1
        delay = None
        if prev is not None and prev.sender != them:
            a, b = _ts(prev), _ts(m)
            if a and b:
                delay = max(0.0, (b - a).total_seconds() / 60)
        run = 1
        j = i + 1
        while j < len(msgs) and msgs[j].sender == them:
            run, j = run + 1, j + 1
        ts = _ts(m)
        r = decode_message(m.text, your_last=" ".join(your_turn) if burst == 1 else None,
                           delay_min=delay if burst == 1 else None, hour=ts.hour if ts else None,
                           platform=platform, stage=stage, burst=run if burst == 1 else 1)
        r["index"] = i
        r["timestamp"] = m.timestamp
        reads.append(r)
        prev = m
    overview = _overview(msgs, reads, them, me, platform, stage)
    if last:
        reads = reads[-last:]
    return {"them": them, "me": me, "messages": reads, "overview": overview}


def _avg(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _overview(msgs: list[Message], reads: list[dict], them: str, me: str | None, platform, stage) -> dict:
    if not reads:
        return {"verdict": f"No texts from {them} to read.", "interest": None}
    theirs = [m for m in msgs if m.sender == them]
    yours = [m for m in msgs if m.sender != them]
    scores = [r["interest"]["score"] for r in reads]
    third = max(1, len(scores) // 3)
    early, late = _avg(scores[:third]), _avg(scores[-third:])
    trend = late - early

    def words(ms):
        return _avg([len(WORD.findall(m.text)) for m in ms])

    def qrate(ms):
        return _avg([1.0 if "?" in m.text else 0.0 for m in ms])

    effort = {"their_words": round(words(theirs), 1), "your_words": round(words(yours), 1),
              "their_questions": round(qrate(theirs) * 100), "your_questions": round(qrate(yours) * 100)}

    # Who starts conversations (first text after 3+ hours of silence, or the very first text).
    # A slow answer to your question isn't starting a conversation, so those don't count.
    starts = {"them": 0, "you": 0}
    last_ts = None
    for k, m in enumerate(msgs):
        ts = _ts(m)
        gap = ts and last_ts and (ts - last_ts).total_seconds() / 60 > CONVO_GAP_MIN
        prev_text = msgs[k - 1].text if k else ""
        answering = k > 0 and msgs[k - 1].sender != m.sender and ("?" in prev_text or len(WORD.findall(prev_text)) >= 8)
        if k == 0 or (gap and not answering):
            starts["them" if m.sender == them else "you"] += 1
        last_ts = ts or last_ts

    # Reply speed: how long each side takes to answer the other.
    delays = {"them": [], "you": []}
    for a, b in zip(msgs, msgs[1:]):
        if a.sender != b.sender:
            ta, tb = _ts(a), _ts(b)
            if ta and tb:
                d = (tb - ta).total_seconds() / 60
                if d <= CONVO_GAP_MIN * 8:
                    delays["them" if b.sender == them else "you"].append(d)
    speed = {k: (round(median(v), 1) if v else None) for k, v in delays.items()}
    their_d = delays["them"]
    speed_trend = None
    if len(their_d) >= 6:
        h = len(their_d) // 2
        speed_trend = round(median(their_d[h:]) - median(their_d[:h]), 1)

    dry_streak = 0
    for r in reversed(reads):
        if r["category"] in ("dry", "soft_rejection"):
            dry_streak += 1
        else:
            break

    # Stage: recent texts count more.
    votes: dict[str, float] = {}
    for w, r in enumerate(reads[-20:], start=1):
        d = r["stage"]["detected"]
        if d:
            votes[d] = votes.get(d, 0) + w
    cur_stage = stage or (max(votes, key=votes.get) if votes else "talking")
    if dry_streak >= 3:
        cur_stage = "fading"

    flags = {"green": {}, "yellow": {}, "red": {}}
    for r in reads:
        for color, labels in r["flags"].items():
            for lab in labels:
                flags[color][lab] = flags[color].get(lab, 0) + 1

    risk = 25.0
    risk += max(0, -trend) * 0.8
    risk -= max(0, trend) * 0.3
    risk += dry_streak * 9
    if effort["your_words"] and effort["their_words"] * 2.2 < effort["your_words"]:
        risk += 14
    if effort["their_questions"] + 10 < effort["your_questions"]:
        risk += 8
    if starts["you"] >= 3 and starts["them"] * 3 <= starts["you"]:
        risk += 12
    if speed_trend is not None and speed_trend > 60:
        risk += 10
    if speed["them"] is not None and speed["you"] is not None and speed["them"] > max(60, speed["you"] * 4):
        risk += 8
    risk -= 6 * min(3, len(flags["green"]))
    risk += 0.3 * (50 - late)
    if cur_stage in ("fading", "situationship"):
        risk += 10
    ghost = _clamp(risk)

    reasons = []
    if trend <= -8:
        reasons.append(f"Their interest has dropped (about {early:.0f} → {late:.0f}).")
    elif trend >= 8:
        reasons.append(f"Their interest has gone up (about {early:.0f} → {late:.0f}).")
    if dry_streak >= 2:
        reasons.append(f"Their last {dry_streak} texts were dry or non-committal.")
    if effort["your_words"] and effort["their_words"] * 2.2 < effort["your_words"]:
        reasons.append(f"You write much more than they do ({effort['your_words']} vs {effort['their_words']} words a text).")
    if starts["you"] >= 3 and starts["them"] * 3 <= starts["you"]:
        reasons.append(f"You start most conversations ({starts['you']} vs {starts['them']}).")
    elif starts["them"] > starts["you"]:
        reasons.append(f"They start most conversations ({starts['them']} vs {starts['you']}), a good sign.")
    if speed_trend is not None and speed_trend > 60:
        reasons.append("Their replies are getting slower.")
    if effort["their_questions"] >= 30:
        reasons.append(f"They ask a lot of questions ({effort['their_questions']}% of their texts).")

    last_read = reads[-1]
    st = STAGES[cur_stage]
    verdict = _verdict(late, ghost, cur_stage, flags)
    return {
        "verdict": verdict,
        "interest": {"now": round(late), "start": round(early), "trend": round(trend),
                     "label": _interest_label(round(late)), "series": scores},
        "stage": {"key": cur_stage, "name": st["name"], "about": st["about"], "do": st["do"], "dont": st["dont"],
                  "watch": st["ghost_risks"]},
        "ghost_risk": {"score": ghost, "level": _level(ghost), "reasons": reasons},
        "effort": effort,
        "starts": starts,
        "reply_minutes": speed,
        "reply_trend_minutes": speed_trend,
        "dry_streak": dry_streak,
        "flags": {c: [{"label": k, "count": v} for k, v in sorted(d.items(), key=lambda kv: -kv[1])] for c, d in flags.items()},
        "next_move": {"about": last_read["text"], "category": last_read["category_name"], "goal": last_read["goal"],
                      "advice": last_read["advice"], "replies": last_read["replies"], "avoid": last_read["avoid"]},
        "platform": PLATFORMS.get(platform) if platform else None,
        "texts_read": len(reads),
    }


def _verdict(interest: float, ghost: int, stage: str, flags: dict) -> str:
    if flags["red"]:
        return "There are red flags here (pressure or control). Put your comfort first; you don't owe anyone a reply."
    if stage == "fading" or ghost >= 60:
        return "It's cooling off. Give one clear, low-pressure opening (ideally a plan), then let them come to you."
    if stage == "dtr":
        return "This is close to official. Don't dodge the 'what are we' moment; say how you feel clearly."
    if stage == "second_base":
        return "Things are getting physical. Keep the pace mutual, check in, and keep texting outside of hookups."
    if interest >= 65:
        return "They're into you. Keep the energy matched and turn it into plans in real life."
    if interest >= 45:
        return "Interest is there but not strong yet. Ask better questions and suggest a low-key plan."
    return "They're lukewarm. Don't over-invest; match their effort and see if they step up."


def format_message(r: dict) -> str:
    lines = [f"\"{r['text']}\"", f"  {r['summary']}  ·  stage: {r['stage']['name']}  ·  ghost risk: {r['ghost_risk']['level']} ({r['ghost_risk']['score']})"]
    lines.append(f"  type: {r['category_name']}" + (f" — {r['lead']}" if r["lead"] != r["category_name"] else ""))
    for imp in r["implications"]:
        lines.append(f"  means: {imp}")
    if r["slang"] or r["emoji"]:
        dec = [f"{h['term']} = {h['meaning']}" for h in r["slang"]] + [f"{e['emoji']} = {e['meaning']}" for e in r["emoji"]]
        lines.append("  decoded: " + "; ".join(dec))
    for t in r["typing"]:
        lines.append(f"  typing: {t['label']}" + (f" ({t['detail']})" if t.get("detail") else "") + f" — {t['meaning']}")
    for color in ("red", "yellow", "green"):
        if r["flags"][color]:
            lines.append(f"  {color} flag: " + ", ".join(r["flags"][color]))
    if r["generation"]:
        lines.append(f"  texts like: {r['generation']['name']} ({', '.join(r['generation']['markers'])})")
    lines.append(f"  goal: {r['goal']}")
    for a in r["advice"]:
        lines.append(f"  how: {a}")
    for rep in r["replies"]:
        lines.append(f"  reply ({rep['style']}): {rep['text']}")
    lines.append("  avoid: " + "; ".join(r["avoid"]))
    return "\n".join(lines)


def format_overview(o: dict, them: str) -> str:
    if o.get("interest") is None:
        return o["verdict"]
    i, g, e = o["interest"], o["ghost_risk"], o["effort"]
    lines = [f"== {them}: the big picture ({o['texts_read']} texts read) ==", o["verdict"], "",
             f"interest now: {i['now']}/100 ({i['label']}), was {i['start']}",
             f"stage: {o['stage']['name']} — {o['stage']['about']}",
             f"ghosting risk: {g['level']} ({g['score']}/100)"]
    lines += [f"  · {r}" for r in g["reasons"]]
    lines.append(f"effort: they average {e['their_words']} words and ask questions in {e['their_questions']}% of texts; "
                 f"you: {e['your_words']} words, {e['your_questions']}%")
    lines.append(f"who starts conversations: them {o['starts']['them']}, you {o['starts']['you']}")
    rm = o["reply_minutes"]
    if rm["them"] is not None:
        lines.append(f"typical reply time: them {_fmt_delay(rm['them'])}, you {_fmt_delay(rm['you']) if rm['you'] is not None else '?'}")
    for color in ("red", "yellow", "green"):
        if o["flags"][color]:
            lines.append(f"{color} flags: " + ", ".join(f"{f['label']} ×{f['count']}" for f in o["flags"][color][:5]))
    lines.append("do: " + "; ".join(o["stage"]["do"]))
    lines.append("don't: " + "; ".join(o["stage"]["dont"]))
    nm = o["next_move"]
    lines += ["", f"next move (their last text: \"{nm['about']}\" — {nm['category']})", f"  goal: {nm['goal']}"]
    lines += [f"  how: {a}" for a in nm["advice"]]
    lines += [f"  reply ({r['style']}): {r['text']}" for r in nm["replies"]]
    return "\n".join(lines)
