// Rarebit promo scene, Paperback Chic cut (pb2). Pure frame function: renderFrame(t).
// The shared brand module owns palette, type, logo, and semantic marks. This
// file owns layout and motion only.
//
// Story: a long Pi session, printed as a typewritten page, scrolls past. The
// camera pulls back until the whole session is one page. The Rarebit sieve
// sweeps down it: tool traffic falls through into a sand pile (the kept
// source); user messages and agent prose catch on the sieve, glint, and are set
// as clean book text. Chapters II–IV restage the real Pi TUI for Recall, Recap,
// and Fork.
import { RarebitBrand } from '../brand.mjs';

const W = 1920;
const H = 1080;
const canvas = document.getElementById('out');
const ctx = canvas.getContext('2d');
const TL = globalThis.TL;
const C = RarebitBrand.tokens.colors;
const F = RarebitBrand.tokens.fonts;

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);
const jerk = u => { const k = clamp(u); return k * k * k * (10 - 15 * k + 6 * k * k); };
const prog = (t, a, b) => smooth(clamp((t - a) / (b - a)));
const easeOut = k => 1 - (1 - k) * (1 - k);
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- text with a size audit ----------
// role: 'body' (≥ 40 px), 'label' (≥ 32 px), or 'texture' (never read).
let audit = null;
function fontString(size, o = {}) {
  return `${o.italic ? 'italic ' : ''}${o.weight ?? 400} ${size}px ${o.font ?? F.body}`;
}
function measure(value, size, o = {}) {
  ctx.save(); ctx.font = fontString(size, o); ctx.letterSpacing = `${o.ls ?? 0}px`;
  const w = ctx.measureText(value).width; ctx.restore(); return w;
}
function text(value, x, y, size, o = {}) {
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.001 || size < 1) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = fontString(size, o);
  ctx.letterSpacing = `${o.ls ?? 0}px`;
  ctx.fillStyle = o.color ?? C.ink;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
  if (audit && (o.role ?? 'body') !== 'texture' && ctx.globalAlpha >= 0.95) {
    const m = ctx.getTransform();
    audit.push({ value, size: size * Math.hypot(m.a, m.b), role: o.role ?? 'body' });
  }
  ctx.restore();
}
const label = (value, x, y, o = {}) =>
  text(value.toUpperCase(), x, y, o.size ?? 32, { font: F.label, weight: o.weight ?? 500, ls: o.ls ?? 5, color: o.color ?? C.muted, role: 'label', ...o });
const mono = (value, x, y, size, o = {}) => text(value, x, y, size, { font: F.mono, role: 'label', ...o });
function wipe(t, a, b, x, y, w, h, draw) {
  const k = prog(t, a, b);
  if (k <= 0) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w * k, h); ctx.clip(); draw(); ctx.restore();
}

// ---------- paper ----------
let grain = null;
function paperGrain() {
  if (grain) return grain;
  grain = document.createElement('canvas');
  grain.width = W; grain.height = H;
  const g = grain.getContext('2d');
  const image = g.createImageData(W, H);
  const r = rng(7);
  for (let i = 0; i < W * H; i++) {
    const v = r(), p = i * 4;
    if (v > 0.985) { image.data[p] = 70; image.data[p + 1] = 55; image.data[p + 2] = 35; image.data[p + 3] = 26; }
    else if (v < 0.35) { image.data[p] = 255; image.data[p + 1] = 250; image.data[p + 2] = 238; image.data[p + 3] = 14; }
  }
  g.putImageData(image, 0, 0);
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  v.addColorStop(0, 'rgba(120,90,50,0)');
  v.addColorStop(1, 'rgba(120,90,50,0.16)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return grain;
}
function page() {
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(paperGrain(), 0, 0);
}
function chrome(name, folio = TL.chrome[name][1], folioAlpha = 1) {
  const [head] = TL.chrome[name];
  if (head) {
    label('Rarebit', 160, 70, { weight: 600, color: C.ink });
    label(head, 1760, 70, { align: 'right' });
    ctx.fillStyle = C.rule; ctx.fillRect(160, 102, 1600, 2);
  }
  if (folio != null) text(String(folio), 960, 1046, 34, { align: 'center', color: C.muted, role: 'label', alpha: folioAlpha });
}
function caption(t) {
  for (const [value, a, b] of TL.captions) {
    if (t < a || t > b) continue;
    const alpha = clamp(Math.min((t - a) / 0.3, (b - t) / 0.3));
    text(value, 960, 214, 52, { align: 'center', italic: true, alpha });
  }
}
function card(x, y, w, h, fill = C.paperBright) {
  ctx.save();
  ctx.fillStyle = 'rgba(60,40,20,0.10)'; ctx.fillRect(x + 6, y + 8, w, h);
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.rule; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.restore();
}
const rule = (x, y, w, k = 1) => { ctx.fillStyle = C.rule; ctx.fillRect(x, y, w * k, 2); };
function typed(t, a, b, value) {
  if (t < a) return '';
  return value.slice(0, Math.round(value.length * clamp((t - a) / (b - a))));
}
function mark(kind, x, y, size, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha; RarebitBrand.drawMark(ctx, kind, x, y, size); ctx.restore();
}
// Catch cue: a neutral ring pulse. Cheddar never marks an event, and a stop is not a success.
function glint(x, y, k, size = 34) {
  if (k <= 0 || k >= 1) return;
  ctx.save(); ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.globalAlpha = 0.7 * (1 - k);
  ctx.beginPath(); ctx.arc(x, y, size * (0.4 + 0.8 * easeOut(k)), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ---------- the session, as the Pi TUI prints it ----------
// [type, text, rare-bit index]. Types follow the Pi TUI: user blocks are tinted,
// tool calls start with `$` or a tool name, output is dim, meta lines are faint.
const DOC = [
  ['user', 'GET /users?page=2 returns the page 1 users. Find the cause and fix it. Keep the public API unchanged.', 0],
  ['meta', 'TPS 38.1 tok/s · TTFT 2.7s · in 468 · out 224'],
  ['tool', '$ npm test'],
  ['out', '  ▶ page 1 lists users 1-10'], ['out', '  ✔ page 1 lists users 1-10 (0.9ms)'], ['out', '  ✖ page 2 lists users 11-20'],
  ['out', '    AssertionError: 1 !== 11'], ['out', '  ... (41 earlier lines, ctrl+o to expand)'], ['meta', 'Took 0.4s'],
  ['prose', 'npm test reproduces the bug: after requesting page 1, page 2 starts at user 1 instead of 11.', 1],
  ['tool', 'read src/cache.js'],
  ['out', '  1 // Response cache for the users API.'], ['out', '  2 const store = new Map();'], ['out', '  4 export function cacheKey(req) {'],
  ['out', '  6   return `${req.method}:${req.path}`;'], ['out', '  9 export function cached(req, compute) {'], ['out', '  ...'],
  ['tool', 'read src/api/users.js'],
  ['out', '  1 import { cached } from \'../cache.js\';'], ['out', '  6 export function getUsers(req) {'], ['out', '  7   return cached(req, () => {'], ['out', '  ...'],
  ['meta', 'TPS 36.3 tok/s · TTFT 1.9s · in 640 · out 114'],
  ['prose', 'The cache key is only method:path, so both pages use GET:/users. I’ll include query parameters in the key.', 2],
  ['tool', 'edit src/cache.js'],
  ['out', ' - 5   // BUG: ignores the query string'], ['out', ' - 6   return `${req.method}:${req.path}`;'],
  ['out', ' + 5   const query = Object.entries(req.query ?? {}).sort();'], ['out', ' + 6   return `${req.method}:${req.path}:${JSON.stringify(query)}`;'],
  ['tool', 'edit test/users.test.js'],
  ['out', ' + test(\'query parameter order does not prevent cache reuse\', () => {'], ['out', ' +   clearCache();'], ['out', ' +   assert.strictEqual(reordered, first);'],
  ['tool', '$ npm test; git diff --check; git diff --stat; git diff'],
  ['out', '  ✔ page 1 lists users 1-10'], ['out', '  ✔ page 2 lists users 11-20'], ['out', '  ✔ query parameter order does not prevent cache reuse'],
  ['out', '  2 files changed, 14 insertions(+), 2 deletions(-)'], ['out', '  ... (53 earlier lines, ctrl+o to expand)'], ['meta', 'Took 0.2s'],
  ['prose', 'Fixed in src/cache.js: cache keys ignored query parameters. Keys now include sorted query parameters.', 3],
  ['meta', 'TPS 35.5 tok/s · TTFT 1.4s · in 921 · out 59'],
  ['user', 'Good. Check whether anything else builds cache keys the same way, then stop and tell me what’s left for review.', 4],
  ['tool', '$ git status --short; git ls-files; rg -n \'cacheKey|cached\\(|cache\' .'],
  ['out', '  ./src/cache.js:4:17:export function cacheKey(req) {'], ['out', '  ./src/cache.js:10:15:  const key = cacheKey(req);'],
  ['out', '  ./src/api/users.js:1:10:import { cached } from \'../cache.js\';'], ['out', '  ./test/users.test.js:4:15:import { clearCache }'],
  ['out', '  ./test/users.test.js:22:8:  clearCache();'], ['out', '  ... (18 earlier lines, ctrl+o to expand)'], ['meta', 'Took 0.0s'],
  ['prose', 'Checked the repository: src/cache.js is the only cache-key builder. Left for review: src/cache.js, test/users.test.js.', 5],
  ['meta', 'TPS 34.6 tok/s · TTFT 2.2s · in 571 · out 83'],
];
const N = DOC.length;
const COLD = { rowH: 46, size: 28, x: 200, top: 280, rows: 12 };
const ZOOM = { top: 290, height: 560, sx: 0.5 };
ZOOM.rowH = ZOOM.height / N;
const charW = COLD.size * 0.6;
const rowColor = type => (type === 'user' || type === 'prose' ? C.ink : type === 'meta' ? C.rule : C.muted);

function scrollRows(t) {
  return (N - COLD.rows) * smooth(clamp((t - 0.3) / 5.2));
}
// Row geometry at camera state z (0 = reading, 1 = whole session on one page).
function layout(t) {
  const z = jerk((t - 6.0) / 1.8);
  const rowH = lerp(COLD.rowH, ZOOM.rowH, z);
  const sx = lerp(1, ZOOM.sx, z);
  const s = rowH / COLD.rowH;
  const offset = lerp(scrollRows(Math.min(t, 6.0)) * COLD.rowH, 0, z);
  const x0 = lerp(COLD.x, 960 - (1520 * ZOOM.sx) / 2, z);
  const top = lerp(COLD.top, ZOOM.top, z);
  return { z, rowH, sx, s, offset, x0, top, y: i => top + i * rowH - offset + rowH / 2 };
}
const rowWidth = row => Math.min(row[1].length * charW, 1500);
function sessionPage(t, o = {}) {
  const L = layout(t);
  const textAlpha = clamp((L.rowH - 16) / 12);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 262, W, 612); ctx.clip();
  DOC.forEach((row, i) => {
    const [type, value, bit] = row;
    const y = L.y(i);
    if (y < 240 || y > 900) return;
    const rare = bit != null;
    if (rare && o.hideRare?.(bit)) return;
    const fall = !rare && o.fall ? o.fall(i) : 0;
    if (fall >= 1) return;
    const alpha = 1 - fall;
    if (type === 'user') {
      ctx.fillStyle = C.faint; ctx.globalAlpha = alpha;
      ctx.fillRect(L.x0 - 12 * L.sx, y - L.rowH / 2 + 1, 1520 * L.sx, L.rowH - 2);
      ctx.globalAlpha = 1;
    }
    const color = rowColor(type);
    if (textAlpha > 0) {
      ctx.save(); ctx.translate(L.x0, y); ctx.scale(L.sx, L.s);
      text(value, 0, 0, COLD.size, { font: F.mono, color, alpha: alpha * textAlpha, role: 'texture' });
      ctx.restore();
    }
    if (textAlpha < 1) {
      const lead = (value.length - value.trimStart().length) * charW * L.sx;
      ctx.fillStyle = color; ctx.globalAlpha = alpha * (1 - textAlpha) * (rare ? 0.9 : 0.55);
      ctx.fillRect(L.x0 + lead, y - L.rowH * 0.22, rowWidth(row) * L.sx - lead, Math.max(2, L.rowH * 0.44));
      ctx.globalAlpha = 1;
    }
    if (rare && o.caught) o.caught(bit, L.x0, y);
  });
  ctx.restore();
  // Pi's scrollbar: a short thumb over a long session
  const k = 1 - L.z;
  if (k > 0) {
    ctx.globalAlpha = k;
    ctx.fillStyle = C.faint; ctx.fillRect(1740, 270, 6, 590);
    ctx.fillStyle = C.muted; ctx.fillRect(1740, 270 + (L.offset / (N * COLD.rowH)) * 590, 6, 590 * COLD.rows / N);
    ctx.globalAlpha = 1;
  }
}

// ---------- the sieve and the sand ----------
const SIEVE = { a: 8.2, b: 10.9, from: 250, to: 1130 };
const sieveY = t => lerp(SIEVE.from, SIEVE.to, clamp((t - SIEVE.a) / (SIEVE.b - SIEVE.a)));
const passTime = y => SIEVE.a + (SIEVE.b - SIEVE.a) * (y - SIEVE.from) / (SIEVE.to - SIEVE.from);
const ZL = layout(8.0);
const GRAINS = [];
{
  const r = rng(42);
  DOC.forEach((row, i) => {
    if (row[2] != null) return;
    const y = ZL.y(i);
    const lead = (row[1].length - row[1].trimStart().length) * charW * ZL.sx;
    const w = rowWidth(row) * ZL.sx - lead;
    const start = passTime(y);
    const grains = [];
    for (let j = 0, n = Math.max(3, Math.round(w / 4.5)); j < n; j++) {
      const dx = 900 + (r() + r() + r() + r() - 2) * 280;
      const hMax = 96 * Math.max(0, 1 - ((dx - 900) / 600) ** 2);
      grains.push({ x0: ZL.x0 + lead + r() * w, y0: y + (r() - 0.5) * 4, x1: dx, y1: 1000 - r() * hMax, delay: r() * 0.25, dur: 0.8 + r() * 0.5, dark: r() < 0.3 });
    }
    GRAINS.push({ i, start, grains });
  });
}
const fallOf = t => i => {
  const g = GRAINS.find(row => row.i === i);
  return g ? clamp((t - g.start) / 0.25) : 0;
};
function sand(t) {
  for (const row of GRAINS) {
    if (t < row.start) continue;
    for (const g of row.grains) {
      const u = clamp((t - row.start - g.delay) / g.dur);
      ctx.fillStyle = g.dark ? C.ink : C.muted;
      ctx.globalAlpha = g.dark ? 0.55 : 0.7;
      ctx.fillRect(lerp(g.x0, g.x1, easeOut(u)) - 1.8, lerp(g.y0, g.y1, u * u) - 1.8, 3.6, 3.6);
    }
  }
  ctx.globalAlpha = 1;
}
function sieve(t) {
  if (t < SIEVE.a - 0.2 || t > SIEVE.b) return;
  const y = sieveY(t), x = ZL.x0 - 70, w = 1520 * ZOOM.sx + 140, h = 44;
  ctx.save();
  ctx.fillStyle = 'rgba(250,245,234,0.55)'; ctx.fillRect(x, y - h / 2, w, h);
  ctx.beginPath(); ctx.rect(x, y - h / 2, w, h); ctx.clip();
  ctx.strokeStyle = C.muted; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
  for (let k = -h; k < w + h; k += 14) {
    ctx.beginPath(); ctx.moveTo(x + k, y - h / 2); ctx.lineTo(x + k + h, y + h / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + k + h, y - h / 2); ctx.lineTo(x + k, y + h / 2); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = C.ink; ctx.fillRect(x, y - h / 2 - 3, w, 3); ctx.fillRect(x, y + h / 2, w, 3);
  ctx.fillStyle = C.ink; ctx.fillRect(x + w, y - 30, 220, 60);
  label('Rarebit', x + w + 110, y + 1, { align: 'center', color: C.paperBright, weight: 600, ls: 6 });
}
function pileLabel(t, from) {
  const k = prog(t, from, from + 0.5);
  if (k <= 0) return;
  wipe(t, from, from + 0.5, 1240, 930, 560, 90, () => text('tool traffic, still in the source', 1760, 968, 40, { align: 'right', italic: true, color: C.muted }));
}

// ---------- the rare bits, set clean ----------
const COL = { x: 330, markX: 280, y0: 300, gap: 80, size: 42 };
const colY = i => COL.y0 + i * COL.gap;
const gatherAt = i => 11.0 + i * 0.3;
function bitSize(i) {
  const w = measure(TL.bits[i][1], COL.size);
  return w > 1440 ? COL.size * 1440 / w : COL.size;
}
function rareBits(t) {
  // caught bars (from the zoomed page) travel to the clean column
  TL.bits.forEach(([kind, value], i) => {
    const docIndex = DOC.findIndex(row => row[2] === i);
    const y0 = ZL.y(docIndex);
    const u = jerk((t - gatherAt(i)) / 1.3);
    const x = lerp(ZL.x0 - 30, COL.x, u), y = lerp(y0, colY(i), u);
    const size = lerp(8, bitSize(i), u);
    if (u < 1) {
      ctx.fillStyle = C.ink; ctx.globalAlpha = 0.9 * (1 - u);
      ctx.fillRect(ZL.x0, y0 - 2, rowWidth(DOC[docIndex]) * ZL.sx, 4);
      ctx.globalAlpha = 1;
    }
    text(value, x, y, size, { alpha: clamp(u * 1.6), role: u < 1 ? 'texture' : 'body' });
    const caught = passTime(y0);
    const mx = lerp(ZL.x0 - 22, COL.markX, u);
    mark(kind, mx, y, lerp(12, kind === 'agent_stop' ? 32 : 28, u), prog(t, caught, caught + 0.15));
    glint(mx, y, (t - caught) / 0.45, 22);
    glint(COL.markX, colY(i), (t - gatherAt(i) - 1.2) / 0.45, 30);
  });
}
function highlights(t) {
  TL.bits.forEach(([, value, phrase], i) => {
    if (!phrase) return;
    const a = 21.0 + [0, 3, 5].indexOf(i) * 0.8;
    const k = prog(t, a, a + 0.55);
    if (k <= 0) return;
    const size = bitSize(i);
    const start = COL.x + measure(value.slice(0, value.indexOf(phrase)), size);
    const w = measure(phrase, size) + 12;
    ctx.fillStyle = C.highlight; ctx.globalAlpha = 0.8;
    ctx.fillRect(start - 6, colY(i) + 2, w * k, size * 0.5);
    ctx.globalAlpha = 1;
  });
}

// ---------- chapter I ----------
function chapterOne(t, name) {
  page();
  const statusAlpha = 1 - prog(t, 6.2, 7.2);
  chrome(name, t < 8 ? null : 1, prog(t, 8.0, 8.6));
  mono('~/demo-cache (master)  ·  context 6.3% of 272k', 960, 1040, 32, { align: 'center', color: C.muted, alpha: statusAlpha, role: statusAlpha > 0.95 ? 'label' : 'texture' });
  if (t >= 20.6) highlights(t);
  sessionPage(Math.min(t, 8.0), {
    fall: t >= SIEVE.a ? fallOf(t) : null,
    hideRare: t >= 11.0 ? () => true : null,
  });
  if (t >= SIEVE.a) sand(t);
  if (t >= SIEVE.a) {
    // caught rows before they are lifted
    if (t < 11.0) {
      TL.bits.forEach(([kind], i) => {
        const docIndex = DOC.findIndex(row => row[2] === i);
        const y0 = ZL.y(docIndex), caught = passTime(y0);
        mark(kind, ZL.x0 - 22, y0, 12, prog(t, caught, caught + 0.15));
        glint(ZL.x0 - 22, y0, (t - caught) / 0.45, 22);
      });
    } else rareBits(t);
  }
  sieve(t);
  pileLabel(t, 17.4);
  wipe(t, 22.6, 23.2, 320, 820, 1200, 80, () => text('This demo session: 51 entries in, 6 rare bits out.', 330, 860, 40, { italic: true, color: C.muted }));
  caption(t);
}

// ---------- chapter II: Recall (the Pi TUI, restaged) ----------
const X = 200;
function editor(t, value, from = 0) {
  rule(160, 902, 1600); rule(160, 988, 1600);
  mono(value, X, 945, 34, { color: C.ink });
  const blink = Math.floor(t * 2) % 2 === 0;
  if (blink && t >= from) { ctx.fillStyle = C.ink; ctx.fillRect(X + measure(value, 34, { font: F.mono }) + 4, 926, 3, 38); }
}
function recall(t) {
  page(); chrome('recall');
  const sent = t >= 29.8;
  editor(t, sent ? '' : typed(t, 28.4, 29.6, TL.recall.command), 28.3);
  if (sent) {
    const u = jerk((t - 29.8) / 0.6);
    const top = lerp(900, 290, u), h = 300;
    ctx.fillStyle = C.faint; ctx.fillRect(160, top, 1600, h * clamp(u * 1.4));
    ctx.save(); ctx.beginPath(); ctx.rect(160, top, 1600, h * clamp(u * 1.4)); ctx.clip();
    text('Rarebit Recall', X, top + 50, 40, { weight: 600 });
    mono('Conversation — rarebit-conversation.json', X, top + 120, 34, { color: C.ink });
    mono('Detailed evidence — rarebit-evidence.json', X, top + 180, 34, { color: C.muted });
    mono('Current request — What did I ask for, and what is left for review?', X, top + 240, 34, { color: C.muted });
    ctx.restore();
    // the agent reads the conversation file first
    wipe(t, 31.0, 31.5, X - 10, 630, 1200, 60, () => mono('read rarebit-conversation.json', X, 660, 36, { color: C.muted }));
    const r = prog(t, 31.2, 32.0);
    if (r > 0 && r < 1) { ctx.fillStyle = C.ink; ctx.fillRect(X - 26, lerp(390, 660, r) - 16, 8, 32); }
    TL.recall.reply.forEach((line, i) => wipe(t, 31.8 + i * 0.3, 32.2 + i * 0.3, X - 10, 710 + i * 56, 1500, 56,
      () => mono(line, X, 738 + i * 56, 40, { color: C.ink, role: 'body' })));
  }
  caption(t);
}

// ---------- chapter III: Recap ----------
function summary(t) {
  page(); chrome('summary');
  mono('Checked: src/cache.js is the only cache-key builder.', X, 300, 34, { color: C.muted });
  mono('Left for review: src/cache.js, test/users.test.js.', X, 350, 34, { color: C.muted });
  wipe(t, 38.4, 38.8, X - 10, 400, 1500, 60, () => mono('Rarebit Summary triggered (6 Rarebits)', X, 430, 32, { color: C.muted }));
  const k = prog(t, 38.9, 39.3);
  rule(160, 500, 1600, k); rule(160, 800, 1600, k);
  wipe(t, 39.2, 39.6, X - 10, 520, 1500, 60, () => mono('Recap · appears finished · as of 28 Sept, 9:10 pm', X, 552, 34, { color: C.muted }));
  TL.summary.forEach((line, i) => wipe(t, 39.8 + i * 0.4, 40.4 + i * 0.4, X - 10, 600, 1500, 200,
    () => mono(line, X, 640 + i * 70, 42, { color: C.ink, role: 'body' })));
  wipe(t, 41.8, 42.3, X - 10, 860, 1560, 60, () => label('* Summary is optional and written by your model. Illustrative text.', X, 890, { ls: 2 }));
  caption(t);
}

// ---------- chapter IV: Fork ----------
const FORK = { L: [160, 270, 780, 560], R: [980, 270, 780, 560] };
const shortBit = value => (value.length > 34 ? `${value.slice(0, 32).trimEnd()} …` : value);
function forkSource(x, y) {
  // the source session as texture: every row, tool traffic included
  DOC.forEach((row, i) => {
    const yy = y + 80 + i * 8.4;
    const [type, value, bit] = row;
    const w = Math.min(row[1].length * 7.2, 680);
    ctx.fillStyle = type === 'user' ? C.faint : 'transparent';
    if (type === 'user') ctx.fillRect(x + 20, yy - 4, 740, 8);
    ctx.fillStyle = bit != null ? C.ink : type === 'meta' ? C.faint : C.rule;
    ctx.fillRect(x + 40, yy - 2, w, 4);
    void value;
  });
}
function fork(t) {
  page(); chrome('fork');
  const [lx, ly, lw, lh] = FORK.L, [rx, ry, rw, rh] = FORK.R;
  card(lx, ly, lw, lh); card(rx, ry, rw, rh);
  label('source session', lx + 30, ly + 42);
  label('new session', rx + 30, ry + 42, { alpha: prog(t, 47.4, 47.8) });
  forkSource(lx, ly);
  wipe(t, 48.2, 48.6, rx + 20, ry + 70, 700, 60, () => mono('Resumed session', rx + 30, ry + 100, 32, { color: C.muted }));
  TL.bits.forEach(([kind, value], i) => {
    const docIndex = DOC.findIndex(row => row[2] === i);
    const y0 = ly + 80 + docIndex * 8.4, y1 = ry + 170 + i * 62;
    const u = jerk((t - 47.4 - i * 0.18) / 1.0);
    if (t < 47.4) return;
    const x = lerp(lx + 40, rx + 80, u), y = lerp(y0, y1, u) - Math.sin(Math.PI * u) * 40;
    mark(kind, lerp(lx + 30, rx + 44, u), y, lerp(8, kind === 'agent_stop' ? 26 : 22, u), clamp(u * 3));
    text(shortBit(value), x, y, lerp(8, 40, u), { alpha: clamp(u * 1.5), role: u < 1 ? 'texture' : 'body' });
  });
  wipe(t, 50.4, 50.8, lx, ly + lh + 20, 780, 60, () => label('context 6.3% of 272k', lx, ly + lh + 44));
  wipe(t, 50.6, 51.0, rx, ry + rh + 20, 780, 60, () => label('context 0.3% of 272k', rx, ry + rh + 44, { color: C.ink }));
  wipe(t, 51.2, 51.6, 1000, 950, 760, 60, () => text('Context figures from this demo session.', 1760, 976, 40, { align: 'right', italic: true, color: C.muted }));
  const cmd = typed(t, 46.4, 47.0, '/rarebit fork');
  ctx.fillStyle = C.dark; ctx.fillRect(lx, 940, 420, 72);
  mono(cmd, lx + 30, 976, 40, { weight: 700, color: C.darkText });
  caption(t);
}

// ---------- cover ----------
function end(t) {
  page();
  RarebitBrand.drawLogo(ctx, 960, 150, 140);
  text('RAREBIT', 974, 292, 124, { align: 'center', font: F.label, weight: 500, ls: 28 });
  const band = prog(t, 55.4, 56.1);
  ctx.fillStyle = C.cover; ctx.fillRect(0, 400, W * band, 300);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 400, W * band, 300); ctx.clip();
  text('Catch up on long Pi sessions.', 960, 510, 80, { align: 'center', italic: true, weight: 500 });
  text('Keep the rare bits. Leave the traffic.', 960, 604, 50, { align: 'center', italic: true, alpha: prog(t, 56.2, 56.6) });
  ctx.restore();
  const w = 1260;
  wipe(t, 56.9, 57.4, 960 - w / 2, 800, w, 110, () => {
    ctx.fillStyle = C.dark; ctx.fillRect(960 - w / 2, 800, w, 110);
    text(RarebitBrand.copy.install, 960, 856, 46, { align: 'center', font: F.mono, weight: 700, color: C.darkText });
  });
  label('github.com/deephbz/rarebit', 960, 990, { align: 'center', ls: 4, alpha: prog(t, 57.8, 58.2) });
}

// ---------- frame ----------
function drawScene(name, t) {
  if (['cold', 'zoom', 'sift', 'value'].includes(name)) chapterOne(t, name);
  else if (name === 'recall') recall(t);
  else if (name === 'summary') summary(t);
  else if (name === 'fork') fork(t);
  else end(t);
}
const sceneAt = t => (TL.scenes.find(([, a, b]) => t >= a && t < b) ?? TL.scenes.at(-1))[0];

export function renderFrame(t) {
  if (!Number.isFinite(t)) throw new TypeError('renderFrame(t) needs finite seconds');
  const time = clamp(t, 0, TL.DUR - 1 / TL.FPS);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const name = sceneAt(time);
  const turn = TL.turns.find(([scene, , b]) => scene === name && time < b);
  if (!turn) { drawScene(name, time); return; }
  const [, a, b] = turn;
  const u = jerk((time - a) / (b - a));
  const prev = sceneAt(a - 0.001);
  const saved = audit; audit = null;
  ctx.save(); ctx.translate(-W * 0.35 * u, 0); drawScene(prev, a - 0.001);
  ctx.fillStyle = `rgba(35,30,24,${0.35 * u})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.save(); ctx.translate(W * (1 - u), 0);
  const shade = ctx.createLinearGradient(-60, 0, 0, 0);
  shade.addColorStop(0, 'rgba(35,30,24,0)'); shade.addColorStop(1, 'rgba(35,30,24,0.28)');
  ctx.fillStyle = shade; ctx.fillRect(-60, 0, 60, H);
  drawScene(name, time);
  ctx.restore();
  audit = saved;
}

window.renderAt = (time, type = 'image/jpeg', quality = 0.93) => {
  renderFrame(time);
  return canvas.toDataURL(type, quality);
};
window.auditAt = time => { audit = []; renderFrame(time); const result = audit; audit = null; return result; };
window.renderFrame = renderFrame;

const requiredFonts = [
  ['EB Garamond', 400, 'normal'], ['EB Garamond', 500, 'normal'], ['EB Garamond', 600, 'normal'], ['EB Garamond', 400, 'italic'], ['EB Garamond', 500, 'italic'],
  ['Jost', 500, 'normal'], ['Jost', 600, 'normal'],
  ['Courier Prime', 400, 'normal'], ['Courier Prime', 700, 'normal'],
];
await Promise.all(requiredFonts.map(([family, weight, style]) => document.fonts.load(`${style} ${weight} 32px "${family}"`)));
await document.fonts.ready;
for (const [family, weight, style] of requiredFonts) {
  if (!document.fonts.check(`${style} ${weight} 32px "${family}"`)) throw new Error(`Required brand font did not load: ${family} ${weight} ${style}`);
}
paperGrain();
renderFrame(0);
window.ready = true;
