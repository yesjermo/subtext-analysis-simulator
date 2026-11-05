/* Subtext screenshot reader: chat screenshots become messages, in the browser. Mirrors subtext/screenshots.py.
 *
 * Every chat app draws their bubbles on the left and yours on the right. Tesseract.js reads the words
 * and where they sit (it is downloaded once from a CDN and runs on this device; the images are never
 * uploaded), then lines are grouped into bubbles, app clutter is dropped, and screenshots are stitched
 * together where you scrolled.
 *
 *   SubtextShots.read(files, progress, them = "Them", me = "Me") -> Promise<[{sender, text, timestamp: null}]>
 */
(() => {
  "use strict";
  const SHOT = window.SUBTEXT_DATA.screenshot;
  const SHOT_JUNK = SHOT.junk.map((p) => new RegExp(`^(?:${p})$`, "i"));
  const KEEP_SHORT = new Set(SHOT.keep_short);
  const STRIP_PREFIX = new RegExp(SHOT.strip_prefix); // profile-picture circles read as a stray "O"
  const TIME_TAIL = new RegExp(SHOT.time_tail, "i");      // "hey 9:41 PM ✓✓": WhatsApp's time inside the bubble
  const TIME_ONLY = new RegExp(SHOT.time_only, "i");
  const HEADER_TIME = new RegExp(SHOT.header_time, "i");  // "alex Today at 9:41 PM": Discord
  const TIME_BESIDE = new RegExp(SHOT.time_beside, "i");
  const LABEL_CAPS = new RegExp(SHOT.label_caps);         // "ALEX", "ME": Snapchat (case matters here)
  const USERNAME = new RegExp(SHOT.username);             // "alex", "riley.p": a name on a line of its own
  const ME_LABELS = new Set(SHOT.me_labels);
  const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  // Fix the usual OCR slips: "|" read for "I", emoji read as stray symbols.
  const cleanOcr = (t) => t.replace(/(^|\s)\|(?=\s|$|')/g, "$1I").replace(/\s*[®©™¢]+\s*$/, "").trim();

  function isJunk(text) {
    const t = text.trim();
    if (!t) return true;
    if (KEEP_SHORT.has(t.toLowerCase())) return false;
    return SHOT_JUNK.some((rx) => rx.test(t));
  }

  // [{side: "left"|"right", text}] for one screenshot, top to bottom. `them` is their name, used to tell
  // a name label (Snapchat, Discord) is theirs.
  function bubblesFromPage(rawLines, them = null) {
    const raw = rawLines.map((l) => ({ ...l, text: l.text.trim().replace(STRIP_PREFIX, "") }));
    // The app's header names who the chat is with: a name label that matches it is theirs.
    const title = raw.filter((l) => l.y1 < SHOT.top + 0.02).map((l) => l.text).join(" ").toLowerCase();
    let lines = raw.filter((l) => SHOT.top <= l.y0 && l.y1 <= SHOT.bottom && l.text)
      .sort((a, b) => (Math.round(a.y0 * 1000) - Math.round(b.y0 * 1000)) || (a.x0 - b.x0));
    if (!lines.length) return [];
    const heights = lines.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
    const lineH = heights[heights.length >> 1] || 0.02;

    const labelled = labelledLayout(lines, lineH, title, them);
    if (labelled) return labelled;

    // WhatsApp-style: a time (and ticks) inside each bubble. Strip it from the words only when the screen is
    // laid out that way, so "meet at 9:30 pm" in an ordinary chat keeps its time.
    const tails = lines.filter((l) => !isJunk(l.text) && !TIME_ONLY.test(l.text) && TIME_TAIL.test(l.text)).length;
    if (tails >= 2) lines = lines.map((l) => ({ ...l, text: l.text.replace(TIME_TAIL, "") }));
    // A time on its own line belongs to the bubble just above it, and says which side that bubble is on.
    const times = lines.filter((l) => TIME_ONLY.test(l.text));
    lines = lines.filter((l) => !isJunk(l.text) && !TIME_ONLY.test(l.text));
    if (!lines.length) return [];

    const groups = [];
    for (const l of lines) { // stacked, left-aligned lines are one bubble
      const g = groups[groups.length - 1];
      if (g && l.y0 - g.y1 < 0.45 * lineH && Math.abs(l.x0 - g.x0) < 0.03) {
        g.texts.push(l.text.trim()); g.x1 = Math.max(g.x1, l.x1); g.y1 = l.y1;
      } else groups.push({ texts: [l.text.trim()], x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 });
    }
    for (const t of times) {
      const near = groups.filter((g) => g.y0 - 0.2 * lineH <= t.y0 && t.y0 <= g.y1 + 1.0 * lineH && t.x0 >= g.x0 - 0.02);
      if (near.length) {
        const g = near.reduce((a, b) => (b.y0 > a.y0 ? b : a));
        g.x1 = Math.max(g.x1, t.x1);
      }
    }
    const leftEdge = Math.min(...groups.map((g) => g.x0));
    const rightEdge = Math.max(...groups.map((g) => g.x1));
    const tol = SHOT.align_tolerance;
    const out = [];
    for (const g of groups) {
      const onLeft = g.x0 - leftEdge < tol, onRight = rightEdge - g.x1 < tol;
      let side;
      if (onLeft && !onRight) side = "left";
      else if (onRight && !onLeft) side = "right";
      else if (onLeft && onRight) side = g.x0 < 1 - g.x1 ? "left" : "right"; // spans the screen
      else continue; // centred: date dividers
      const text = cleanOcr(g.texts.join(" "));
      if (text) out.push({ side, text });
    }
    return out;
  }

  const sameRow = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
  const escapeRx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Snapchat and Discord: no bubbles. Every line is on the left, under the name of who sent it
  // ("ALEX" / "ME", or "alex  Today at 9:41 PM"). null when the screen isn't laid out that way.
  function labelledLayout(lines, lineH, title, them) {
    const names = new Map();
    const repeats = new Map();
    for (const l of lines) repeats.set(l.text, (repeats.get(l.text) || 0) + 1);
    const inTitle = (name) => new RegExp(`(?<![\\w])${escapeRx(name.toLowerCase())}(?![\\w])`).test(title);
    lines.forEach((l, i) => {
      const t = l.text, m = t.match(HEADER_TIME), next = lines[i + 1];
      if (m) names.set(i, m[1]);
      else if (LABEL_CAPS.test(t) && t.split(/\s+/).length <= 3 && next && next.y0 - l.y1 < 1.5 * lineH
        && Math.abs(next.x0 - l.x0) < 0.06 && !LABEL_CAPS.test(next.text)) names.set(i, t);
      else if (t.length <= 24 && t.split(/\s+/).length <= 2
        && lines.some((o) => o !== l && o.x0 > l.x1 && sameRow(o, l) && TIME_BESIDE.test(o.text))) names.set(i, t);
      // a name on its own line (its small time wasn't read): it repeats, or it's the chat's title
      else if (USERNAME.test(t) && !isJunk(t) && !KEEP_SHORT.has(t.toLowerCase()) && (repeats.get(t) >= 2 || inTitle(t))) names.set(i, t);
    });
    if (names.size < 2 || new Set([...names.values()].map((n) => n.trim().toLowerCase())).size < 2) return null; // "lol" twice
    const body = lines.filter((l, i) => !names.has(i) && !isJunk(l.text));
    if (body.some((l) => l.x0 > 0.35 && l.x1 > 0.85)) return null; // something against the right edge: bubbles

    // Who is who: "ME" is you; the name in the app's header (or the one you gave) is them; in a one-to-one
    // chat whoever is left is the other person. Failing all that, the first name is them.
    const order = [...new Set([...names.values()].map((n) => n.trim()))];
    const known = (name) => {
      const n = name.toLowerCase();
      if (ME_LABELS.has(n)) return "right";
      if ((them && n === them.trim().toLowerCase()) || inTitle(n)) return "left";
      return null;
    };
    const sides = new Map(order.map((n) => [n, known(n)]));
    if ([...sides.values()].includes(null)) {
      const hasLeft = [...sides.values()].includes("left"), hasRight = [...sides.values()].includes("right");
      order.forEach((n, i) => {
        if (sides.get(n) === null) sides.set(n, hasLeft ? "right" : hasRight ? "left" : (i === 0 ? "left" : "right"));
      });
    }
    const out = [];
    let current = null;
    lines.forEach((l, i) => {
      if (names.has(i)) { current = names.get(i).trim(); return; }
      if (current === null || isJunk(l.text) || TIME_BESIDE.test(l.text)) return; // sender off screen, or a lone time
      const text = cleanOcr(l.text);
      if (text) out.push({ side: sides.get(current), text });
    });
    return out;
  }

  const normText = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  function similarity(x, y) { // 1 - edit distance / length, like Python's SequenceMatcher ratio
    const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
      let diag = prev[0]; prev[0] = i;
      for (let j = 1; j <= y.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return 1 - prev[y.length] / Math.max(x.length, y.length, 1);
  }
  // Same sender and nearly the same text: OCR can read one screenshot as "7?" and the next as "77?".
  function sameBubble(a, b) {
    if (a.sender !== b.sender) return false;
    const x = normText(a.text), y = normText(b.text);
    if (x === y) return true;
    if (Math.min(x.length, y.length) < 2) return !!(x && y) && Math.abs(x.length - y.length) <= 1 && (x.includes(y) || y.includes(x)); // "7" vs "77"
    return similarity(x, y) >= 0.6;
  }
  function stitch(existing, add) { // drop bubbles repeated where you scrolled, or screenshots you already added
    if (!add.length) return existing;
    for (let start = Math.max(0, existing.length - 400); start <= existing.length - add.length; start++) {
      if (add.every((m, i) => sameBubble(existing[start + i], m))) return existing;
    }
    for (let k = Math.min(existing.length, add.length); k > 0; k--) {
      if (existing.slice(-k).every((m, i) => sameBubble(m, add[i]))) return existing.concat(add.slice(k));
    }
    return existing.concat(add);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("couldn't load the screenshot reader (are you offline?)"));
      document.head.append(s);
    });
  }

  // Second pass, for white text on coloured bubbles (iMessage blue, Messenger purple, dark mode).
  // A pixel becomes black text only when it is bright AND its surroundings are not: white letters
  // inside a coloured bubble. A white page stays white, so the text reader sees ordinary dark text
  // on a light page instead of white pills on a black screen (which it skips).
  function brightTextMask(bmp) {
    const W = bmp.width, H = bmp.height;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, W, H), px = img.data;
    // The surroundings: the image shrunk so each cell averages a patch wider than a letter's stroke.
    // A pixel counts only if no cell around it is page-white, so the curved edge where a bubble
    // meets the page (bright, next to blue) isn't read as stray "I", ")" or "1".
    const cell = Math.max(6, Math.round(W / 80)), sw = Math.max(1, Math.round(W / cell)), sh = Math.max(1, Math.round(H / cell));
    const small = document.createElement("canvas");
    small.width = sw; small.height = sh;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(bmp, 0, 0, sw, sh);
    const around = sctx.getImageData(0, 0, sw, sh).data;
    const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const brightest = new Float32Array(sw * sh); // the brightest cell in each 3 × 3 neighbourhood
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < sh && xx >= 0 && xx < sw) m = Math.max(m, lum(around, (yy * sw + xx) * 4));
      }
      brightest[y * sw + x] = m;
    }
    for (let y = 0; y < H; y++) {
      const sy = Math.min(sh - 1, Math.floor((y / H) * sh));
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const k = sy * sw + Math.min(sw - 1, Math.floor((x / W) * sw));
        const text = lum(px, i) > 200 && brightest[k] < 205;
        px[i] = px[i + 1] = px[i + 2] = text ? 0 : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Third pass, for dark text on a bright bubble on a dark screen (TikTok's turquoise, Snapchat dark mode).
  // Each patch of the image gets its background brightness (the brighter quarter of its pixels, so the
  // letters in it don't count): that's the bubble's colour. A pixel is a letter when it is clearly darker than that, and every patch
  // around it is bright, so bubble edges and grey bubbles on the dark screen stay out of it.
  function darkTextOnBrightMask(bmp) {
    const W = bmp.width, H = bmp.height;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, W, H), px = img.data;
    const cell = Math.max(8, Math.round(W / 50)), sw = Math.ceil(W / cell), sh = Math.ceil(H / cell);
    const lumAt = (i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const hist = new Uint32Array(sw * sh * 16), count = new Uint32Array(sw * sh);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = Math.floor(y / cell) * sw + Math.floor(x / cell);
      hist[c * 16 + Math.min(15, lumAt((y * W + x) * 4) >> 4)]++; count[c]++;
    }
    const typical = new Float32Array(sw * sh);
    for (let c = 0; c < sw * sh; c++) {
      let seen = 0, b = 0;
      while (b < 15 && seen + hist[c * 16 + b] <= count[c] * 0.75) seen += hist[c * 16 + b++]; // the brighter quarter
      typical[c] = b * 16 + 8;
    }
    const brightAround = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < sh && xx >= 0 && xx < sw && typical[yy * sw + xx] < 120) { ok = 0; break; }
      }
      brightAround[y * sw + x] = ok;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, c = Math.floor(y / cell) * sw + Math.floor(x / cell);
      px[i] = px[i + 1] = px[i + 2] = brightAround[c] && lumAt(i) < typical[c] - 50 ? 0 : 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // How dark the screenshot is overall (0 black, 255 white), from a small copy.
  function brightness(bmp) {
    const c = document.createElement("canvas");
    c.width = 40; c.height = 80;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, 40, 80);
    const d = ctx.getImageData(0, 0, 40, 80).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  }

  // A line as Tesseract reads it. Snapchat draws a coloured bar beside each message, which reads as a leading
  // "I" or "|": drop a one-character first word that is taller than the letters after it (a real "I" isn't).
  function lineFrom(l, W, H) {
    let words = (l.words || []).filter((w) => w.text.trim());
    if (words.length >= 2 && /^[|Il!1[\]]$/.test(words[0].text.trim())) {
      const rest = words.slice(1).map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
      const typical = rest[rest.length >> 1] || 0;
      const bar = words[0].bbox;
      if (typical && bar.y1 - bar.y0 > 1.15 * typical) words = words.slice(1);
    }
    const text = words.length ? words.map((w) => w.text.trim()).join(" ") : l.text.trim();
    const x0 = words.length ? Math.min(...words.map((w) => w.bbox.x0)) : l.bbox.x0;
    return { text, conf: l.confidence, x0: x0 / W, x1: l.bbox.x1 / W, y0: l.bbox.y0 / H, y1: l.bbox.y1 / H };
  }

  let ocrWorker = null;
  async function readScreenshots(files, progress, them = "Them", me = "Me") {
    progress("Loading the screenshot reader…");
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    if (!ocrWorker) {
      ocrWorker = await window.Tesseract.createWorker("eng");
      await ocrWorker.setParameters({ tessedit_pageseg_mode: "11" }); // sparse text: scattered short bubbles
    }
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let messages = [];
    for (const [i, f] of sorted.entries()) {
      progress(`Reading screenshot ${i + 1} of ${sorted.length}…`);
      let bmp;
      try { bmp = await createImageBitmap(f); } catch { throw new Error(`${f.name}: this browser can't open that image (convert HEIC to PNG or JPG)`); }
      // Pass 1 reads dark text on light bubbles; pass 2 white text on coloured bubbles (brightTextMask).
      // Small images (cropped or downsized) are also read at twice the size; every reading is kept and
      // the most confident one wins at each spot below.
      const scales = bmp.width < 800 ? [1, 2] : [1];
      const dark = brightness(bmp) < 100; // dark mode: also look for dark letters on bright bubbles
      const found = [];
      for (const scale of scales) {
        const img = scale === 1 ? bmp
          : await createImageBitmap(bmp, { resizeWidth: bmp.width * scale, resizeHeight: bmp.height * scale, resizeQuality: "high" });
        const W = img.width, H = img.height;
        const toLines = (data) => (data.lines || []).filter((l) => l.text.trim()).map((l) => lineFrom(l, W, H));
        const plain = document.createElement("canvas");
        plain.width = W; plain.height = H;
        plain.getContext("2d").drawImage(img, 0, 0);
        found.push(...toLines((await ocrWorker.recognize(plain)).data));
        found.push(...toLines((await ocrWorker.recognize(brightTextMask(img))).data));
        if (dark) found.push(...toLines((await ocrWorker.recognize(darkTextOnBrightMask(img))).data));
        if (img !== bmp && img.close) img.close();
      }
      if (bmp.close) bmp.close();
      const overlaps = (a, b) => {
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        return w > 0 && h > 0 && w * h > 0.5 * Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      };
      // Where both passes read the same spot, keep the more confident reading.
      const lines = [];
      for (const l of found.sort((a, b) => b.conf - a.conf)) {
        if (l.conf >= 30 && !lines.some((m) => overlaps(l, m))) lines.push(l);
      }
      window.SubtextShots.lastLines = lines; // what was read, kept for checking a misread screenshot
      const bubbles = bubblesFromPage(lines, them === "Them" ? null : them).map((b) => ({ sender: b.side === "left" ? them : me, text: b.text, timestamp: null }));
      messages = stitch(messages, bubbles);
    }
    progress("");
    return messages;
  }

  window.SubtextShots = { read: readScreenshots, bubblesFromPage, stitch, isJunk, cleanOcr, IMAGE_RE };
})();
