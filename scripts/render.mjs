// Makes the README preview images in images/ from the real generated geometry (three.js studio render in headless Chrome).
// Needs: npm i -D playwright (and a Chromium it can launch). Run: node scripts/render.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Module from 'manifold-3d';
import opentype from 'opentype.js';
import { buildCap, manifoldToArrays, GRIPS, DENSITY } from '../src/core.js';
import { fontFiles } from './fontlist.mjs';
import { bundle } from './build.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'images');
fs.mkdirSync(outDir, { recursive: true });

const wasm = await Module(); wasm.setup();
const fonts = fontFiles.map((f) => { const b = fs.readFileSync(f); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); });

const hex = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));   // sRGB -> linear
// One cap -> non-indexed triangles with per-vertex colour: body colour, plus a second colour in the engraved recess (as if paint-filled).
function cap(opts, body, text) {
  const o = { boreD: 35.3, ...opts }, IR = o.boreD / 2;
  const m = buildCap(wasm, fonts, o), { pos, idx } = manifoldToArrays(m); m.delete();
  const P = [], C = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => [pos[idx[t + k] * 3], pos[idx[t + k] * 3 + 1], pos[idx[t + k] * 3 + 2]]);
    const cx = (v[0][0] + v[1][0] + v[2][0]) / 3, cy = (v[0][1] + v[1][1] + v[2][1]) / 3, cz = (v[0][2] + v[1][2] + v[2][2]) / 3;
    const isText = cz > 0.01 && cz < 0.81 &&   // whole recess (floor + walls): looks like a paint-filled engraving
       Math.hypot(cx, cy) < IR - 0.5;
    for (const p of v) { P.push(...p); C.push(...hex(isText ? text : body)); }
  }
  return { pos: P, col: C };
}

const scenes = {};

// 1) hero
const heroCaps = [
  { o: { text: 'ADVENTURE\n2026', grip: 'diamond', gripCount: 36 }, b: '#2a2e37', t: '#ff7a1a', x: 0, y: 0 },
  { o: { text: 'ΑΘΗΝΑ\nΚαλημέρα', grip: 'fluted' }, b: '#e9e6df', t: '#16a085', x: -46, y: 24 },
  { o: { text: 'SURF 🌊\nAUG ★ 2026', grip: 'wavy', gripCount: 20 }, b: '#ff7a1a', t: '#ffffff', x: 46, y: 22 },
];
scenes.hero = {
  w: 1600, h: 900, bg: ['#3a4560', '#10141c'], cam: { pos: [0, -150, 104], target: [0, 10, 2], fov: 27 }, light: [-70, -60, 110],
  caps: heroCaps.map((c) => ({ ...cap(c.o, c.b, c.t), x: c.x, y: c.y })),
};

// 2) grip styles
const gripKeys = Object.keys(GRIPS);
scenes.grips = {
  w: 1600, h: 880, bg: ['#272e3f', '#0d1016'], cam: { pos: [0, -246, 184], target: [0, -2, 0], fov: 27 }, light: [-70, -70, 110],
  caps: gripKeys.map((g, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    return { ...cap({ text: g === 'smooth' ? 'SMOOTH' : GRIPS[g].split(' ')[0].toUpperCase(), grip: g, gripCount: DENSITY[g], sizeFactor: 0.8 }, '#d9dde6', '#ff7a1a'),
      x: (col - 1.5) * 54, y: (0.5 - row) * 76, label: GRIPS[g], labelDy: -25 };
  }),
};

// 3) languages
const langs = [
  ['ΑΘΗΝΑ', 'Καλημέρα', 'Greek', '#2a2e37', '#ff7a1a'],
  ['Москва', 'Привет', 'Cyrillic', '#e9e6df', '#c0392b'],
  ['Việt Nam', 'Xin chào', 'Vietnamese', '#1f6f5c', '#ffffff'],
  ['SURF 🌊', '❤ ★ ☀ ☕', 'Emoji & symbols', '#ff7a1a', '#1b1b1b'],
  ['Łódź', 'Zażółć gęślą', 'Polish & Latin Extended', '#3a56c5', '#ffd23f'],
  ['ÅÄÖ Ünï', 'Çñß ¿¡ €', 'Accents & currency', '#8e44ad', '#ffffff'],
];
scenes.languages = {
  w: 1600, h: 880, bg: ['#272e3f', '#0d1016'], cam: { pos: [0, -206, 155], target: [0, -2, 0], fov: 27 }, light: [-70, -70, 110],
  caps: langs.map(([l1, l2, label, b, t], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    return { ...cap({ text: `${l1}\n${l2}`, grip: ['fluted', 'gear', 'wavy', 'polygon', 'dimples', 'diamond'][i], gripCount: DENSITY[['fluted', 'gear', 'wavy', 'polygon', 'dimples', 'diamond'][i]] }, b, t),
      x: (col - 1) * 62, y: (0.5 - row) * 76, label, labelDy: -25 };
  }),
};

// 4) printed orientation, open end up
scenes.inside = {
  w: 1600, h: 900, bg: ['#2b3244', '#0d1016'], cam: { pos: [-22, -62, 76], target: [0, 0, 4], fov: 30 }, light: [-70, -60, 110],
  caps: [{ ...cap({ text: 'YOUR TEXT', grip: 'fluted' }, '#ff7a1a', '#ffffff'), x: 0, y: 0, flip: true }],
};

const html = `<!doctype html><meta charset="utf-8"><body><div id="wrap"><canvas id="c"></canvas></div><script>${await bundle('src/render.js')}</script>`;
const tmp = path.join(outDir, '.render.html');
fs.writeFileSync(tmp, html);
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(scenes);
for (const name of only) {
  const s = scenes[name];
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('file://' + tmp);
  await page.evaluate((spec) => window.renderScene(spec), s);
  await page.waitForFunction('window.__done === true');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('wrote', `${name}.png`);
  await page.close();
}
await browser.close();
fs.unlinkSync(tmp);
