// Compare web/engine.js against the Python readings:  node tests/parity/compare_js.js out.json
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "..");
global.window = {};
for (const file of ["web/data.js", "web/engine.js"]) {
  eval(fs.readFileSync(path.join(root, file), "utf8"));
}
const S = window.Subtext, data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const LONG = "omg i just got back from the most chaotic day ever and i need to tell you about it";
let bad = 0;
const diff = (a, b, at) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff(a[key], b[key], `${at}.${key}`);
    }
    return;
  }
  if (bad++ < 25) console.log("DIFF", at, JSON.stringify(a), "|", JSON.stringify(b));
};
data.inputs.forEach((text, i) => {
  const actual = S.decodeMessage(text, {
    yourLast: i % 3 === 0 ? LONG : null,
    delayMin: [null, 2, 400, 2000][i % 4],
    platform: ["snapchat", null][i % 2],
  });
  diff(data.one[i], actual, `one[${i}]`);
});
for (const chat of data.chats) {
  diff(chat.py, S.decodeChat(chat.msgs, chat.them, chat.me), `chat:${chat.them}`);
}
console.log(bad ? `${bad} differences` : `identical: ${data.inputs.length} texts and ${data.chats.length} chats`);
