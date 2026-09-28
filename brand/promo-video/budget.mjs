// Check all caption and in-picture reading holds in timeline.js.
// Rule: 0.2 s per word plus 2 s recognition, or 3 s at 10+ words.
// House rule: new elements add 1 s; repeated patterns add 0.6 s.
import { readFileSync } from 'node:fs';

new Function(readFileSync(new URL('./timeline.js', import.meta.url), 'utf8'))();
const TL = globalThis.TL;
const words = text => text.split(/\s+/).filter(word => /[A-Za-z0-9]/.test(word)).length;
const required = (text, kind) => {
  const count = words(text);
  const recognition = kind === 'super' ? (count >= 10 ? 3 : 2) : kind === 'new' ? 1 : 0.6;
  return count * 0.2 + recognition;
};

const rows = [
  ...TL.captions.map(([text, from, to]) => [text, from, to, 'caption']),
  ...TL.reads,
].sort((a, b) => a[1] - b[1]);

let failures = 0;
for (const [text, from, to, kind] of rows) {
  const actual = to - from;
  const need = required(text, kind === 'caption' ? 'super' : kind);
  const ok = actual + 1e-9 >= need;
  if (!ok) failures += 1;
  console.log(`${ok ? '  ' : '✗ '}${from.toFixed(2).padStart(5)} ${actual.toFixed(2).padStart(5)} / ${need.toFixed(2).padStart(5)} ${kind.padEnd(7)} ${text}`);
}
console.log(`${rows.length} reads, ${failures} short · duration ${TL.DUR.toFixed(1)}s`);
if (failures) process.exit(1);
