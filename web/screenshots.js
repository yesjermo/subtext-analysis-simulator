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

  function bubblesFromPage(rawLines) {
    const lines = rawLines.map((l) => ({ ...l, text: l.text.trim().replace(STRIP_PREFIX, "") }))
      .filter((l) => SHOT.top <= l.y0 && l.y1 <= SHOT.bottom && !isJunk(l.text))
      .sort((a, b) => (Math.round(a.y0 * 1000) - Math.round(b.y0 * 1000)) || (a.x0 - b.x0));
    if (!lines.length) return [];
    const heights = lines.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
    const lineH = heights[heights.length >> 1] || 0.02;
    const groups = [];
    for (const l of lines) { // stacked, left-aligned lines are one bubble
      const g = groups[groups.length - 1];
      if (g && l.y0 - g.y1 < 0.45 * lineH && Math.abs(l.x0 - g.x0) < 0.03) {
        g.texts.push(l.text.trim()); g.x1 = Math.max(g.x1, l.x1); g.y1 = l.y1;
      } else groups.push({ texts: [l.text.trim()], x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 });
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
      const found = [];
      for (const scale of scales) {
        const img = scale === 1 ? bmp
          : await createImageBitmap(bmp, { resizeWidth: bmp.width * scale, resizeHeight: bmp.height * scale, resizeQuality: "high" });
        const W = img.width, H = img.height;
        const toLines = (data) => (data.lines || []).filter((l) => l.text.trim())
          .map((l) => ({ text: l.text.trim(), conf: l.confidence, x0: l.bbox.x0 / W, x1: l.bbox.x1 / W, y0: l.bbox.y0 / H, y1: l.bbox.y1 / H }));
        const plain = document.createElement("canvas");
        plain.width = W; plain.height = H;
        plain.getContext("2d").drawImage(img, 0, 0);
        found.push(...toLines((await ocrWorker.recognize(plain)).data));
        found.push(...toLines((await ocrWorker.recognize(brightTextMask(img))).data));
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
        if (l.conf >= 45 && !lines.some((m) => overlaps(l, m))) lines.push(l);
      }
      const bubbles = bubblesFromPage(lines).map((b) => ({ sender: b.side === "left" ? them : me, text: b.text, timestamp: null }));
      messages = stitch(messages, bubbles);
    }
    progress("");
    return messages;
  }

  window.SubtextShots = { read: readScreenshots, bubblesFromPage, stitch, isJunk, cleanOcr, IMAGE_RE };
})();
