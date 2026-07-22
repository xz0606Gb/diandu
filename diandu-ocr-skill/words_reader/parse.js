const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'words_table.MD');
const raw = fs.readFileSync(src, 'utf8');

const lines = raw.split(/\r?\n/);
const words = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) continue;
  // skip header and separator
  if (trimmed.startsWith('| ---') || /^\| *英文单词/.test(trimmed)) continue;
  const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
  if (cells.length < 5) continue;
  const [en, phonetic, zh, page, unit] = cells;
  if (!en) continue;
  words.push({ en, phonetic, zh, page: Number(page), unit });
}

// Build unit list (logical order: unit1..unit6, then Vocabulary)
const unitSet = new Set();
for (const w of words) unitSet.add(w.unit);
const unitOrder = Array.from(unitSet).sort((a, b) => {
  const na = /unit(\d+)/.exec(a), nb = /unit(\d+)/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  return a.localeCompare(b);
});

// Build page list per unit
const pagesByUnit = {};
for (const w of words) {
  if (!pagesByUnit[w.unit]) pagesByUnit[w.unit] = new Set();
  pagesByUnit[w.unit].add(w.page);
}
for (const u of Object.keys(pagesByUnit)) {
  pagesByUnit[u] = Array.from(pagesByUnit[u]).sort((a, b) => a - b);
}

const out = `// Auto-generated from words_table.MD. Do not edit by hand.
window.VOCAB_DATA = ${JSON.stringify(words, null, 2)};
window.VOCAB_META = ${JSON.stringify({ unitOrder, pagesByUnit }, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, 'data.js'), out, 'utf8');
console.log('Total words:', words.length);
console.log('Units:', unitOrder.join(', '));
console.log('Wrote data.js');
