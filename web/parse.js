/* Subtext parser: chat exports become [{sender, text, timestamp}]. Mirrors subtext/chat_parser.py.
 * WhatsApp ("[date, time] Name: text" and "date, time - Name: text"), plain "Name: text" transcripts,
 * CSV (iMessage / SMS exporters) and JSON (Telegram, or a list of {sender, text, timestamp}).
 */
(() => {
  "use strict";
  // ------------------------------------------------------------------ parsing
  const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?`;
  const DATE = String.raw`\d{1,4}[./-]\d{1,2}[./-]\d{1,4}`;
  const WA_BRACKET = new RegExp(String.raw`^\[(${DATE}),?\s+(${TIME})\]\s*([^:]{1,60}):\s?(.*)$`);
  const WA_DASH = new RegExp(String.raw`^(${DATE}),?\s+(${TIME})\s+-\s+([^:]{1,60}):\s?(.*)$`);
  const SIMPLE = /^([^:\[\]\n]{1,40}):\s+(.+)$/;
  const SKIP = ["<media omitted>", "image omitted", "video omitted", "sticker omitted", "audio omitted",
    "gif omitted", "this message was deleted", "you deleted this message",
    "messages and calls are end-to-end encrypted"];

  const keep = (text) => {
    const lower = text.trim().toLowerCase();
    return lower && !SKIP.some((marker) => lower.includes(marker));
  };

  function parseDate(date, time) {
    // Assumes month/day order (US WhatsApp). Only used for reply-delay and active hours.
    const [a, b, c] = date.split(/[./-]/).map(Number);
    let y, m, d;
    if (String(date).match(/^\d{4}/)) [y, m, d] = [a, b, c];
    else { [m, d, y] = a > 12 ? [b, a, c] : [a, b, c]; if (y < 100) y += 2000; }
    const t = time.replace(/\./g, "").toUpperCase().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/);
    if (!t) return null;
    let h = Number(t[1]);
    if (t[4] === "PM" && h < 12) h += 12;
    if (t[4] === "AM" && h === 12) h = 0;
    const dt = new Date(y, m - 1, d, h, Number(t[2]), Number(t[3] || 0));
    if (isNaN(dt)) return null;
    // Local time without a zone, like subtext/chat_parser.py, so both sides read the same hour.
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  }
  function parseText(raw) {
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/ /g, " ").replace(/[‎﻿]/g, ""));
    const sample = lines.filter((l) => l.trim()).slice(0, 200);
    const score = (re) => sample.filter((line) => re.test(line)).length;
    let pattern = score(WA_BRACKET) >= score(WA_DASH) ? WA_BRACKET : WA_DASH;
    if (score(pattern) === 0) pattern = SIMPLE;
    const out = [];
    for (const line of lines) {
      const m = line.match(pattern);
      if (m) {
        out.push(pattern === SIMPLE
          ? { sender: m[1].trim(), text: m[2].trim(), timestamp: null }
          : { sender: m[3].trim(), text: m[4].trim(), timestamp: parseDate(m[1], m[2]) });
      } else if (out.length && line.trim()) {
        out[out.length - 1].text += "\n" + line.trim();
      }
    }
    return out.filter((m) => keep(m.text));
  }

  const pick = (row, keys) => {
    const lowered = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.toLowerCase().trim(), value]),
    );
    for (const key of keys) {
      if (lowered[key] != null && lowered[key] !== "") return lowered[key];
    }
    return null;
  };
  const textValue = (value) => {
    if (Array.isArray(value)) {
      return value
        .filter((part) => typeof part === "string" || (part && typeof part === "object"))
        .map((part) => (typeof part === "string" ? part : String(part.text || "")))
        .join("");
    }
    return value == null ? "" : String(value);
  };

  function rowsToMessages(rows) {
    return rows
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        sender: pick(row, ["sender", "from", "author", "name", "sender_name", "contact", "who"]),
        text: textValue(pick(row, ["text", "message", "body", "content", "msg"])).trim(),
        timestamp: pick(row, ["timestamp", "date", "time", "datetime", "sent_at", "created_at"]),
      }))
      .filter((message) => message.sender && keep(message.text))
      .map((message) => ({ ...message, sender: String(message.sender).trim() }));
  }

  function parseCSV(raw) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (ch === '"' && raw[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && raw[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const [head, ...body] = rows;
    if (!head) return [];
    return rowsToMessages(body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))));
  }

  function parseFile(name, raw) {
    const lower = String(name || "").toLowerCase();
    if (lower.endsWith(".csv")) return parseCSV(raw);
    if (lower.endsWith(".json")) {
      const data = JSON.parse(raw);
      return rowsToMessages(Array.isArray(data) ? data : data.messages || []);
    }
    return parseText(raw);
  }

  function participants(messages) {
    const counts = new Map();
    for (const m of messages) counts.set(m.sender, (counts.get(m.sender) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  window.SubtextParse = { parseText, parseCSV, rowsToMessages, parseFile, participants };
})();
