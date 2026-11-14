// Self-check: builds caps in Node for every grip style and for text in several scripts; asserts valid solids.
// Run: node scripts/test-core.mjs [outDir]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import opentype from 'opentype.js';
import { buildCap, manifoldToArrays, toBinarySTL, missingChars, layoutText, TEXT_MAX_LENGTH, GRIPS, DENSITY, CAMERAS } from '../src/core.js';
import { fontFiles } from './fontlist.mjs';

// Counts edges not shared by exactly two triangles, the way a slicer sees the exported STL (vertices merged at float32).
function openEdges(pos, idx) {
  const id = new Map(), vid = (i) => { const k = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`; if (!id.has(k)) id.set(k, id.size); return id.get(k); };
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const v = [vid(idx[t]), vid(idx[t + 1]), vid(idx[t + 2])];
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3], k = a < b ? `${a}-${b}` : `${b}-${a}`; edges.set(k, (edges.get(k) || 0) + 1); }
  }
  let bad = 0; for (const c of edges.values()) if (c !== 2) bad++;
  return bad;
}
const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const wasm = await Module(); wasm.setup();
const fonts = fontFiles.map((f) => { const b = fs.readFileSync(f); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); });

const cases = [
  ...CAMERAS.flatMap((c) => (c.shape ? ['fluted', 'gear', 'dimples', 'smooth'] : ['fluted', 'diamond', 'smooth']).map((g) => ({ text: 'YOUR TEXT', grip: g, boreD: c.bore, depth: c.depth, shape: c.shape, corner: c.corner }))),
  ...Object.keys(GRIPS).map((g) => ({ text: 'YOUR TEXT', grip: g, gripCount: DENSITY[g] })),
  ...['diamond', 'spiral', 'dimples', 'gear', 'wavy', 'fluted'].flatMap((g) => [10, 17, 48].map((n) => ({ text: 'ΑΘΗΝΑ 🌊\nΚαλημέρα ★', grip: g, gripCount: n }))),
  ...[10, 17, 48].flatMap((n) => ['fluted', 'gear', 'dimples'].map((g) => ({ text: 'ΑΘΗΝΑ 🌊\nKalimera', grip: g, gripCount: n, boreD: 32.3, depth: 9, shape: 'square', corner: 7 }))),
  { text: 'ΑΘΗΝΑ\nΕλλάδα' },
  { text: 'Москва\nПривет' },
  { text: 'Việt Nam\nŁódź ñ ç' },
  { text: '🌊 SURF 🏄\n❤️ ★ ☀' },
  { text: '' }, { text: ' \n \n' },
  { text: 'B8 OA@&', boreD: 35.0, grip: 'polygon', gripCount: 8 },
];
for (const c of cases) {
  const t = Date.now();
  const miss = missingChars(fonts, c.text || '');
  const m = buildCap(wasm, fonts, c);
  const { pos, idx } = manifoldToArrays(m);
  const row = { ...c, missing: miss.join(''), genus: m.genus(), vol: Math.round(m.volume()), tris: idx.length / 3, ms: Date.now() - t };
  console.log(JSON.stringify(row));
  assert.equal(m.status(), 'NoError');
  assert.ok(m.volume() > 1500 && m.volume() < 20000, 'volume sane');
  assert.equal(miss.length, 0, 'font chain covers the test text');
  assert.equal(openEdges(pos, idx), 0, 'STL (float32, merged vertices) must be closed: every edge shared by exactly 2 triangles');
  if (out) fs.writeFileSync(`${out}/${Object.keys(c).map((k) => c[k]).join('_').replace(/[^\w.-]+/g, '-').slice(0, 60)}.stl`, toBinarySTL(pos, idx));
  m.delete();
}


// Text layout: stays inside the circle however long, wraps at spaces, honours Enter, shrinks when it has to.
const FIT_R = 35.3 / 2 - 1.5, long = 'The quick brown fox jumps over the lazy dog. '.repeat(3).slice(0, TEXT_MAX_LENGTH);
const reach = (rings) => Math.max(0, ...rings.flatMap((r) => r.map(([x, y]) => Math.hypot(x, y))));
const em = (t, f = 1) => { const l = layoutText(fonts, t, FIT_R, f); assert.ok(reach(l.rings) <= FIT_R + 1e-6, `inside circle: ${JSON.stringify(t)}`); return l.em; };
assert.ok(em('A') > 12, 'one letter is big');
assert.ok(em('YOUR TEXT') > 4.5, 'a short text stays on one line at a comfortable size');
assert.ok(em('ADVENTURE 2026') >= 4.5, 'a text too long for one comfortable line wraps at its space (one line would be about 3.6 mm)');
assert.deepEqual(layoutText(fonts, 'ADVENTURE 2026', FIT_R).lines, ['ADVENTURE', '2026'], 'words are kept whole');
assert.ok(layoutText(fonts, 'W'.repeat(60), FIT_R).lines.length > 1, 'a word too long even at small size is split between characters');
assert.ok(em('AB\nCD') > 0 && em('AB\n\nCD') < em('AB\nCD'), 'Enter makes a line, blank lines take space');
assert.ok(em(long) > 1 && em(long) < em('YOUR TEXT'), 'a maximum-length text still fits, smaller');
assert.ok(em('W'.repeat(60)) > 0, 'one very long word is broken between characters');
assert.ok(em('Ελληνικά Кириллица ΑΘΗΝΑ 🌊★ ' + 'x'.repeat(40)) > 0, 'mixed scripts and emoji stay inside');
assert.ok(em('YOUR TEXT', 0.5) < em('YOUR TEXT') * 0.55, 'the size slider scales the text down');
assert.equal(layoutText(fonts, ' \n ', FIT_R).rings.length, 0, 'blank text engraves nothing');
assert.ok(CAMERAS.length && CAMERAS.every((c) => c.bore > 15 && c.bore < 60 && c.depth >= 4 && c.depth <= 14 && (!c.shape || c.corner < c.bore / 2)), 'camera table sane');
assert.equal(new Set(CAMERAS.map((c) => c.id)).size, CAMERAS.length, 'unique camera ids');
console.log('OK');
