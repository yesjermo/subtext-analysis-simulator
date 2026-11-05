/* Subtext importers: the chat exports each app gives you, as conversations. Mirrors subtext/importers.py.
 *
 *   SubtextImport.readText(name, raw)   -> [{title, source, them, me, messages}]   one file's contents
 *   SubtextImport.readFiles(files)      -> Promise of conversations                 browser File objects
 *   SubtextImport.merge(conversations)  -> threads split across files put back together, busiest first
 *
 * Instagram / Messenger JSON, TikTok JSON, Snapchat "My Data" JSON, Android "SMS Backup & Restore" XML,
 * and everything web/parse.js reads (WhatsApp, "Name: text", CSV, generic JSON).
 * Times become local "YYYY-MM-DDTHH:MM:SS" strings, like the Python side.
 */
(() => {
  "use strict";
  const P = window.SubtextParse;
  const ME = "Me";
  const IG_SKIP = new RegExp(
    "^(liked a message|.+ sent an attachment\\.|you sent an attachment\\.|reacted .+ to your message"
    + "|.+ started a (video|audio) chat|(video|audio) chat ended|.+ missed a (video|audio) chat"
    + "|.+ changed the (group photo|theme)\\.?|.+ named the group .+|.+ left the group\\.?)$", "i");

  const pad = (n) => String(n).padStart(2, "0");
  function localIsoFromMs(ms) {
    const d = new Date(Math.trunc(ms / 1000) * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function localIsoFromUtc(text) {
    const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    return m ? localIsoFromMs(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
  }
  // Instagram and Facebook write UTF-8 bytes as \u00XX escapes: turn them back into the real characters.
  function fixMojibake(text) {
    try { return decodeURIComponent(escape(text)); } catch { return text; }
  }
  const ordered = (msgs) => (msgs.every((m) => m.timestamp)
    ? [...msgs].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0)) : msgs);
  const msg = (sender, text, timestamp) => ({ sender, text, timestamp: timestamp || null });
  const conv = (title, source, messages, them = null, me = null) => ({ title, source, them, me, messages });

  function guessSides(c) {
    const people = P.participants(c.messages).map(([p]) => p);
    if (c.me == null && c.them == null && people.length === 2) {
      const mine = people.filter((p) => ["me", "you", "myself"].includes(p.toLowerCase()));
      if (mine.length === 1) c.me = mine[0];
    }
    if (c.them == null && c.me && people.length >= 2) c.them = people.find((p) => p !== c.me) || null;
    if (c.me == null && c.them && people.length === 2) c.me = people.find((p) => p !== c.them) || null;
    return c;
  }

  // ------------------------------------------------------------------ Instagram / Messenger
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function isInstagram(data) {
    return isObj(data) && Array.isArray(data.messages) && "participants" in data
      && data.messages.slice(0, 20).some((m) => isObj(m) && "sender_name" in m);
  }
  function readInstagram(data) {
    const title = fixMojibake(String(data.title || "Instagram chat"));
    const names = (data.participants || []).filter(isObj).map((p) => fixMojibake(String(p.name || "")));
    const msgs = [];
    for (const m of data.messages) {
      if (!isObj(m) || !("sender_name" in m)) continue;
      let text = fixMojibake(String(m.content || "")).trim();
      const share = isObj(m.share) ? m.share : null;
      if (!text && share && share.link) text = String(share.link);
      if (!text || IG_SKIP.test(text)) continue;
      const ts = typeof m.timestamp_ms === "number" ? localIsoFromMs(m.timestamp_ms) : null;
      msgs.push(msg(fixMojibake(String(m.sender_name)), text, ts));
    }
    const them = names.includes(title) ? title : null;
    const me = them && names.length === 2 ? names.find((n) => n !== them) || null : null;
    return [guessSides(conv(title, "instagram", ordered(msgs), them, me))];
  }

  // ------------------------------------------------------------------ TikTok
  function findKey(data, key) {
    if (!isObj(data)) return null;
    if (key in data) return data[key];
    for (const v of Object.values(data)) { const found = findKey(v, key); if (found != null) return found; }
    return null;
  }
  const isTiktok = (data) => isObj(data) && isObj(findKey(data, "ChatHistory"));
  function readTiktok(data) {
    const history = findKey(data, "ChatHistory"), profile = findKey(data, "ProfileMap");
    const me = isObj(profile) && profile.userName ? String(profile.userName) : null;
    const out = [];
    for (const [key, rows] of Object.entries(history)) {
      if (!Array.isArray(rows)) continue;
      const them = key.replace(/^Chat History with\s+|:\s*$/g, "").trim() || key;
      const msgs = [];
      for (const r of rows) {
        if (!isObj(r)) continue;
        const text = String(r.Content || "").trim(), sender = String(r.From || "").trim();
        if (!text || !sender) continue;
        const date = String(r.Date || "");
        msgs.push(msg(sender, text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ? date.replace(" ", "T") : null));
      }
      if (msgs.length) out.push(guessSides(conv(them, "tiktok", ordered(msgs), them, me)));
    }
    return out;
  }

  // ------------------------------------------------------------------ Snapchat
  const SNAP_TEXT_TYPES = new Set(["TEXT", "TEXT_AND_MEDIA", ""]);
  function isSnapchat(data) {
    if (!isObj(data)) return false;
    if ("Received Saved Chat History" in data || "Sent Saved Chat History" in data) return true;
    const rows = Object.values(data).filter(Array.isArray).flatMap((v) => v.slice(0, 5));
    return rows.length > 0 && rows.every((r) => isObj(r) && "From" in r && "Created" in r);
  }
  function readSnapchat(data) {
    const byFriend = new Map();
    const add = (friend, sender, row) => {
      const text = String(row.Content != null ? row.Content : row.Text || "").trim();
      if (!text || !SNAP_TEXT_TYPES.has(String(row["Media Type"] ?? "TEXT").toUpperCase())) return;
      if (!byFriend.has(friend)) byFriend.set(friend, []);
      byFriend.get(friend).push(msg(sender, text, localIsoFromUtc(String(row.Created || ""))));
    };
    if ("Received Saved Chat History" in data || "Sent Saved Chat History" in data) {
      for (const row of data["Received Saved Chat History"] || []) if (isObj(row) && row.From) add(String(row.From), String(row.From), row);
      for (const row of data["Sent Saved Chat History"] || []) if (isObj(row) && row.To) add(String(row.To), ME, row);
    } else {
      for (const [friend, rows] of Object.entries(data)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows) if (isObj(row)) add(String(friend), row.IsSender ? ME : String(row.From || friend), row);
      }
    }
    return [...byFriend].filter(([, m]) => m.length).map(([f, m]) => conv(f, "snapchat", ordered(m), f, ME));
  }

  // ------------------------------------------------------------------ Android SMS Backup & Restore
  const SMS_NODE = /<sms\b([^>]*?)\/?>|<mms\b([^>]*)>([\s\S]*?)<\/mms>/g;
  const XML_ATTR = /([\w:.-]+)="([^"]*)"/g;
  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  // Number codes can be UTF-16 halves (&#55357;&#56898;): building with fromCharCode joins them into the emoji.
  const xmlUnescape = (t) => t.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, r) => {
    if (NAMED[r]) return NAMED[r];
    const n = r.startsWith("#x") ? parseInt(r.slice(2), 16) : parseInt(r.slice(1), 10);
    return n > 0xffff ? String.fromCodePoint(n) : String.fromCharCode(n);
  });
  const attrs = (raw) => Object.fromEntries([...raw.matchAll(XML_ATTR)].map(([, k, v]) => [k, xmlUnescape(v)]));
  const isSmsXml = (raw) => raw.slice(0, 2000).includes("<smses");
  function readSmsXml(raw) {
    const byContact = new Map();
    for (const m of raw.matchAll(SMS_NODE)) {
      let a, text, sent;
      if (m[1] !== undefined) { a = attrs(m[1]); text = a.body || ""; sent = a.type === "2"; }
      else {
        a = attrs(m[2]);
        const parts = [...m[3].matchAll(/<part\b([^>]*?)\/?>/g)].map((p) => attrs(p[1]));
        text = parts.filter((p) => p.ct === "text/plain" && (p.text || "") !== "null").map((p) => p.text || "").join(" ");
        sent = a.msg_box === "2";
      }
      text = text.trim();
      if (!text || text === "null") continue;
      const name = a.contact_name;
      const contact = name && name !== "(Unknown)" ? name : (a.address || "Unknown");
      const date = a.date || "";
      if (!byContact.has(contact)) byContact.set(contact, []);
      byContact.get(contact).push(msg(sent ? ME : contact, text, /^\d+$/.test(date) ? localIsoFromMs(Number(date)) : null));
    }
    return [...byContact].map(([c, m]) => conv(c, "sms", ordered(m), c, ME));
  }

  // ------------------------------------------------------------------ entry points
  const stem = (name) => String(name).split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  function readText(name, raw) {
    const lower = String(name || "").toLowerCase();
    const stripped = raw.replace(/^[﻿ \n\r\t]+/, "");
    if (lower.endsWith(".xml") || stripped.startsWith("<")) {
      if (isSmsXml(stripped)) return readSmsXml(stripped);
      throw new Error(`${name}: an XML file Subtext doesn't know. It reads SMS Backup & Restore exports.`);
    }
    let data = null;
    if (lower.endsWith(".json") || (/^[{[]/.test(stripped) && !/\.(txt|csv)$/.test(lower))) {
      try { data = JSON.parse(stripped); } catch {
        if (lower.endsWith(".json")) throw new Error(`${name}: this .json file isn't valid JSON. Was the download cut short?`);
      }
    }
    if (data !== null) {
      if (isInstagram(data)) return readInstagram(data);
      if (isTiktok(data)) return readTiktok(data);
      if (isSnapchat(data)) return readSnapchat(data);
      const msgs = P.rowsToMessages(Array.isArray(data) ? data : (data && data.messages) || []);
      return msgs.length ? [guessSides(conv(stem(name), "json", msgs))] : [];
    }
    if (lower.endsWith(".csv")) {
      const msgs = P.parseCSV(stripped);
      return msgs.length ? [guessSides(conv(stem(name), "csv", msgs))] : [];
    }
    const msgs = P.parseText(raw);
    if (!msgs.length) return [];
    const wa = stem(name).match(/^WhatsApp Chat (?:with|-)\s*(.+?)(?:\s*\(\d+\))?$/i);
    if (wa) return [guessSides(conv(wa[1], "whatsapp", msgs, msgs.some((x) => x.sender === wa[1]) ? wa[1] : null))];
    return [guessSides(conv(stem(name), msgs.some((x) => x.timestamp) ? "whatsapp" : "text", msgs))];
  }

  function merge(convs) {
    const out = new Map();
    for (const c of convs) {
      const key = `${c.source}\u0000${c.title}`;
      if (!out.has(key)) { out.set(key, { ...c, messages: [...c.messages] }); continue; }
      const into = out.get(key);
      const seen = new Set(into.messages.map((m) => `${m.sender}\u0000${m.text}\u0000${m.timestamp}`));
      into.messages = ordered(into.messages.concat(c.messages.filter((m) => !seen.has(`${m.sender}\u0000${m.text}\u0000${m.timestamp}`))));
    }
    return [...out.values()].sort((a, b) => b.messages.length - a.messages.length);
  }

  const TEXT_FILE = /\.(json|xml|txt|csv)$/i;
  async function readFiles(files) {
    const convs = [];
    const sorted = [...files].filter((f) => TEXT_FILE.test(f.name))
      .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
    for (const f of sorted) convs.push(...readText(f.name, await f.text()));
    return merge(convs);
  }

  window.SubtextImport = { readText, readFiles, merge, fixMojibake, localIsoFromMs };
})();
