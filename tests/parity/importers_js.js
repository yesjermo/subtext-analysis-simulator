// Compare web/importers.js with the Python readings:  node tests/parity/importers_js.js out.json
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..", "..");
global.window = {};
for (const f of ["web/parse.js", "web/importers.js"]) eval(fs.readFileSync(path.join(root, f), "utf8"));
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let bad = 0;
for (const d of data) {
  const js = window.SubtextImport.readText(d.name, d.raw);
  const a = JSON.stringify(d.py), b = JSON.stringify(js);
  if (a !== b) {
    bad++;
    console.log(`DIFF ${d.file}`);
    console.log("  py:", a.slice(0, 300));
    console.log("  js:", b.slice(0, 300));
  }
}
console.log(bad ? `${bad} differences` : `identical: ${data.length} files`);
