// web/screenshots.js on the recorded OCR pages in tests/fixtures/pages.json: same answers as the Python rules.
//   node tests/parity/screenshots_js.js
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..", "..");
global.window = {};
global.document = { createElement: () => ({}) };
for (const f of ["web/data.js", "web/screenshots.js"]) eval(fs.readFileSync(path.join(root, f), "utf8"));
const pages = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/pages.json"), "utf8"));
const want = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/shots/expected.json"), "utf8")).convo;
let bad = 0;
for (const [name, page] of Object.entries(pages)) {
  const got = window.SubtextShots.bubblesFromPage(page.lines);
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`DIFF ${name}:`, JSON.stringify(got)); }
}
const extra = window.SubtextShots.bubblesFromPage([
  { text: "what time tmrw?", x0: 0.05, x1: 0.40, y0: 0.20, y1: 0.22 },
  { text: "meet at 9:30 pm", x0: 0.55, x1: 0.95, y0: 0.25, y1: 0.27 }]);
if (extra.map((b) => b.text).join("|") !== "what time tmrw?|meet at 9:30 pm") { bad++; console.log("DIFF time kept:", JSON.stringify(extra)); }
const lolPage = ["lol", "wait what", "lol", "ok fine"].map((text, i) => ({ text, x0: 0.05, x1: 0.05 + text.length * 0.03, y0: 0.2 + i * 0.04, y1: 0.22 + i * 0.04 }));
const lol = window.SubtextShots.bubblesFromPage(lolPage).map((b) => b.text).join("|");
if (lol !== "lol|wait what|lol|ok fine") { bad++; console.log("DIFF lol twice:", lol); }
console.log(bad ? `${bad} differences` : `identical: ${Object.keys(pages).length + 1} pages`);
