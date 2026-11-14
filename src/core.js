// Cap geometry generator (runs in the browser and in Node).
// z = 0 is the TOP face of the cap (the face that sits on the print bed); the opening is at z = H.

export const GRIPS = {
  smooth: 'Smooth', fluted: 'Fluted', gear: 'Gear teeth', wavy: 'Soft waves',
  polygon: 'Polygon', spiral: 'Spiral', diamond: 'Diamond knurl', dimples: 'Dimples',
};

export const DENSITY = { smooth: 28, fluted: 28, gear: 24, wavy: 20, polygon: 12, spiral: 24, diamond: 36, dimples: 20 };   // a good starting density per style

// ---------- text ----------
const STRIP = /[︎️‍]|\uD83C[\uDFFB-\uDFFF]/g;   // emoji joiners / variation selectors / skin tones
const cleanText = (s) => s.replace(STRIP, '');

function flattenGlyphPath(path, steps = 10) {
  const rings = [];
  let cur = null, px = 0, py = 0;
  const push = (x, y) => { cur.push([x, -y]); px = x; py = y; };
  const close = () => { if (cur && cur.length > 2) rings.push(cur); cur = null; };
  for (const c of path.commands) {
    if (c.type === 'M') { close(); cur = []; push(c.x, c.y); }
    else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q' || c.type === 'C') {
      const x0 = px, y0 = py;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        if (c.type === 'Q') push(u * u * x0 + 2 * u * t * c.x1 + t * t * c.x, u * u * y0 + 2 * u * t * c.y1 + t * t * c.y);
        else push(
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y);
      }
    } else if (c.type === 'Z') close();
  }
  close();
  return rings;
}

const boundsOf = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
};
const mapRings = (rings, f) => rings.map((r) => r.map(([x, y]) => f(x, y)));

// First bundled font that has `ch`, with its glyph (cached per fonts array).
let cacheFonts = null, cache = new Map();
function glyphFor(fonts, ch) {
  if (cacheFonts !== fonts) { cacheFonts = fonts; cache = new Map(); }
  if (!cache.has(ch)) {
    const font = fonts.find((f) => f.charToGlyphIndex(ch) > 0);
    cache.set(ch, font ? { font, g: font.charToGlyph(ch) } : null);
  }
  return cache.get(ch);
}

// Characters no loaded font can draw (so the UI can warn).
export function missingChars(fonts, text) {
  const bad = new Set();
  for (const ch of cleanText(text)) if (ch.trim() && !glyphFor(fonts, ch)) bad.add(ch);
  return [...bad];
}

// One line of text at `em` mm: its width and (optionally) polygon rings with the baseline at y = 0, +y up.
// shortcut: no complex-script shaping or right-to-left ordering (Arabic, Hebrew, Indic), when someone needs that, add a shaper like harfbuzzjs.
function run(fonts, text, em, withRings) {
  const rings = [];
  let x = 0, prev = null;
  for (const ch of cleanText(text)) {
    const hit = glyphFor(fonts, ch);
    if (!hit) continue;
    const { font, g } = hit, k = em / font.unitsPerEm;
    if (prev && prev.font === font) x += (font.getKerningValue(prev.g, g) || 0) * k;
    if (withRings) rings.push(...flattenGlyphPath(g.getPath(x, 0, em)));
    x += g.advanceWidth * k;
    prev = hit;
  }
  return { rings, width: x };
}

// Break one paragraph into lines at spaces. A word wider than a line goes on its own line (and the caller shrinks the text), or with breakWords it is split between characters.
function wrap(fonts, paragraph, em, maxW, breakWords) {
  const lines = [], width = (t) => run(fonts, t, em, false).width;
  let cur = '';
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (width(cur ? `${cur} ${word}` : word) <= maxW) { cur = cur ? `${cur} ${word}` : word; continue; }
    if (cur) { lines.push(cur); cur = ''; }
    if (!breakWords) { cur = word; continue; }
    for (const ch of word) { if (cur && width(cur + ch) > maxW) { lines.push(cur); cur = ''; } cur += ch; }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

export const TEXT_MAX_LENGTH = 120;
const MAX_EM = 16, SINGLE_LINE_MIN_EM = 4.5, WHOLE_WORD_MIN_EM = 3.0, PITCH = 1.25;   // letters are never bigger than MAX_EM mm; text only wraps at spaces once a single line would be smaller than SINGLE_LINE_MIN_EM mm

// Text (Enter = new line) as polygon rings: centred, mirrored in X (the top face looks toward -Z, so text must be flipped to read
// correctly from outside), as large as fits inside a circle of radius fitR. It stays on one line while that is comfortably big,
// then wraps at spaces, then gets smaller; a word is only split between characters when keeping it whole would need letters under WHOLE_WORD_MIN_EM mm. Returns { rings, em, lines } (em = final letter size in mm).
export function layoutText(fonts, text, fitR, sizeFactor = 1) {
  if (!cleanText(text).trim()) return { rings: [], em: 0, lines: [] };
  const paras = text.replace(/\r/g, '').split('\n');
  const box = (em, lines) => {   // widest allowed line for a block of this many lines (rectangle inscribed in the circle)
    const hb = lines * PITCH * em;
    return hb >= 2 * fitR ? 0 : 2 * Math.sqrt(fitR * fitR - (hb / 2) ** 2);
  };
  const fit = (allowWrap, breakWords) => {   // largest size at which every line fits the box; null if none down to 1 mm
    for (let em = MAX_EM; em >= 1; em *= 0.94) {
      let n = paras.length;
      for (let i = 0; i < 40; i++) {
        const w = box(em, n);
        if (!w) break;
        const lines = allowWrap ? paras.flatMap((p) => wrap(fonts, p, em, w, breakWords)) : paras.map((p) => p.trim());
        if (lines.length > n) { n = lines.length; continue; }   // wrapping added lines, so the box got shorter: try again
        if (lines.every((l) => run(fonts, l, em, false).width <= w)) return { em, lines };
        break;
      }
    }
    return null;
  };
  let best = fit(false);
  if (!best || best.em < SINGLE_LINE_MIN_EM) {
    const whole = fit(true, false), split = !whole || whole.em < WHOLE_WORD_MIN_EM ? fit(true, true) : null;
    best = split && (!whole || split.em > whole.em) ? split : whole;
  }
  best ||= { em: 1, lines: paras.flatMap((p) => wrap(fonts, p, 1, 2 * fitR, true)) };

  let placed = [];
  best.lines.forEach((t, i) => {
    const rings = run(fonts, t, best.em, true).rings;
    if (!rings.length) return;
    const b = boundsOf(rings), cx = (b.x0 + b.x1) / 2;
    placed.push(...mapRings(rings, (x, y) => [x - cx, y - i * PITCH * best.em]));   // line i: baseline at y = -i * pitch
  });
  if (!placed.length) return { rings: [], em: 0, lines: [] };
  const b = boundsOf(placed), cy = (b.y0 + b.y1) / 2;
  placed = mapRings(placed, (x, y) => [x, y - cy]);
  let far = 0;
  for (const r of placed) for (const [x, y] of r) far = Math.max(far, Math.hypot(x, y));
  const s = Math.min(1, fitR / far) * sizeFactor;   // emoji and tall glyphs can overshoot the estimate: scale down so every point stays inside
  return { rings: mapRings(placed, (x, y) => [-x * s, y * s]), em: best.em * s, lines: best.lines };
}

// ---------- grip ----------
// Radius of the grip outline at angle `a` for the 2D grip styles (the cutter is everything outside this outline).
// Where the outline would sit exactly on the outer wall it is pushed 0.8 mm outside instead: coincident surfaces make the boolean emit sliver triangles.
function gripRadius(style, a, n, R0, IR) {
  const per = (2 * Math.PI) / n, ph = (((a % per) + per) % per) / per;    // ph: 0..1 inside one period
  const arc = (ph - 0.5) * per * R0;                                      // signed arc distance to the groove centre (mm)
  let r;
  if (style === 'gear') r = R0 - 1.0 * Math.min(1, Math.max(0, (0.27 - Math.abs(ph - 0.5)) / 0.04));   // square teeth, slightly softened
  else if (style === 'wavy') r = R0 + 0.35 - 0.6 * (1 + Math.cos(n * a));
  else if (style === 'polygon') {
    const rc = R0 - 0.2;                                                  // circumradius; flats sit rc*cos(pi/n) from the axis
    return Math.max((rc * Math.cos(Math.PI / n)) / Math.cos((ph - 0.5) * per), IR + 1.4);
  } else {                                                                // fluted / spiral / diamond: round grooves
    const fr = Math.min(1.15, 0.26 * per * R0);
    r = R0 - Math.max(0, Math.sqrt(Math.max(0, fr * fr - arc * arc)) - fr * 0.26);
  }
  return r > R0 - 1e-6 ? R0 + 0.8 : Math.max(r, IR + 1.4);                // never cut into the bore
}

function gripCutter({ Manifold, CrossSection }, style, n, R0, IR, z0, H) {
  const len = H - z0 + 1;
  if (style === 'dimples') {
    const s = (2 * Math.PI * R0) / n, rowPitch = s * 0.866, rr = Math.min(1.6, s * 0.33), depth = 0.9;
    let cut = null;
    for (let row = 0, z = z0 + 1.6; z <= H - 1.2; row++, z += rowPitch) {
      for (let i = 0; i < n; i++) {
        const a = ((i + (row % 2) * 0.5) * 2 * Math.PI) / n, d = R0 + rr - depth;
        const sp = Manifold.sphere(rr, 24).translate([d * Math.cos(a), d * Math.sin(a), z]);
        cut = cut ? cut.add(sp) : sp;
      }
    }
    return cut;
  }
  const twisted = style === 'spiral' || style === 'diamond';
  const samples = twisted ? 360 : 720;
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const a = (2 * Math.PI * i) / samples;
    pts.push([gripRadius(style, a, n, R0, IR) * Math.cos(a), gripRadius(style, a, n, R0, IR) * Math.sin(a)]);
  }
  const negative = CrossSection.circle(R0 + 2, 160).subtract(new CrossSection([pts]));
  const tw = (deg, div, dz = 0) => Manifold.extrude(negative, len + 2 * dz, div, deg).translate([0, 0, z0 + dz]);
  if (style === 'spiral') return tw(40, 32);
  // The two cutters are exact mirror images, which makes the boolean emit slivers along the mirror planes; a tiny turn, a different slice count and a small z offset break that symmetry (values found by sweeping every density 10-48 for open edges).
  if (style === 'diamond') return tw(40, 32).add(tw(-40, 29, 0.021).rotate([0, 0, 0.83]));
  return Manifold.extrude(negative, len).translate([0, 0, z0]);
}

// ---------- cameras ----------
// bore = inner diameter of the cap at the "standard" fit; depth = how deep the cap sits over the lens (fixed per camera, not user-editable).
// Sizes come from measuring the pocket of existing community caps (only the numbers are used). Round: bore = inner diameter.
// Square: bore = side of the rounded-square pocket, corner = its corner radius. depth = pocket depth, fixed per camera.
export const CAMERAS = [
  { id: 'osmo-a5pro', name: 'DJI Osmo Action 5 Pro', bore: 35.3, depth: 8.0 },
  // shortcut: Action 3/4 reuse the 5 Pro size because sellers list one cap for all three; no caliper data.
  { id: 'osmo-a4', name: 'DJI Osmo Action 4', bore: 35.3, depth: 8.0 },
  { id: 'osmo-a3', name: 'DJI Osmo Action 3', bore: 35.3, depth: 8.0 },
  { id: 'osmo-a6', name: 'DJI Osmo Action 6', bore: 37.8, depth: 6.5 },
  { id: 'gopro-9-12', name: 'GoPro Hero 9 / 10 / 11 / 12', shape: 'square', bore: 32.0, corner: 7.0, depth: 9.0 },
  { id: 'gopro-11-mini', name: 'GoPro Hero 11 Mini', shape: 'square', bore: 32.0, corner: 8.0, depth: 6.0 },
  { id: 'insta-one-rs-1in', name: 'Insta360 ONE RS 1-Inch', bore: 48.3, depth: 13.0 },
  // shortcut: the reference cap has a stepped pocket (20.0 mm for 1.6 mm, then 21.7 mm); the wider size is used, so it may be loose. Upgrade when measured on a real GO 3S.
  { id: 'insta-go3s', name: 'Insta360 GO 3S', bore: 21.7, depth: 5.1 },
];
export const FIT_STEPS = { tight: -0.3, standard: 0, loose: 0.3 };
// Outer width (diameter for round caps) and height of the finished cap, for the UI.
export function capSize(o) {
  const wall = o.wall ?? 2.6, top = o.top ?? 2.4;
  return { square: o.shape === 'square', width: o.boreD + 2 * wall, height: top + o.depth };
}
// Grip styles that work on a square cap (the rest need a round outline).
export const SQUARE_GRIPS = ['smooth', 'fluted', 'gear', 'dimples'];
function roundedSquare(side, r, seg = 24) {
  const h = side / 2 - r, pts = [];
  for (const [cx, cy, a0] of [[h, h, 0], [-h, h, 90], [-h, -h, 180], [h, -h, 270]])
    for (let i = 0; i <= seg; i++) { const a = ((a0 + (90 * i) / seg) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

// Points and outward normals every `step` mm along a rounded square's outline (side, corner radius).
function outlineSamples(side, r, n) {
  const h = side / 2 - r, straight = 2 * h, arc = (Math.PI / 2) * r, per = 4 * (straight + arc), out = [];
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per;
    const seg = Math.floor(d / (straight + arc)); d -= seg * (straight + arc);
    const ang = seg * 90;                       // the side's outward direction (deg): 0 = +x, 90 = +y ...
    const rad = (ang * Math.PI) / 180, nx = Math.cos(rad), ny = Math.sin(rad), tx = -ny, ty = nx;
    let x, y, na = ang;
    if (d <= straight) { x = nx * (h + r) + tx * (d - h); y = ny * (h + r) + ty * (d - h); }
    else {
      const t = (d - straight) / r, a2 = rad + t, cx = nx * h + tx * h, cy = ny * h + ty * h;
      x = cx + r * Math.cos(a2); y = cy + r * Math.sin(a2); na = (a2 * 180) / Math.PI;
    }
    out.push({ x, y, na });
  }
  return out;
}

// Grip cutter for a square cap: grooves, notches or dimples placed along the outline.
function squareGripCutter({ Manifold, CrossSection }, style, n, side, r, z0, z1) {
  const pts = outlineSamples(side, r, n), per = 4 * (side - 2 * r) + 2 * Math.PI * r, s = per / n, parts = [];
  if (style === 'fluted') {
    const fr = Math.min(1.15, 0.26 * s), cyl = Manifold.extrude(CrossSection.circle(fr, 24), z1 - z0);
    for (const p of pts) parts.push(cyl.translate([p.x + Math.cos((p.na * Math.PI) / 180) * fr * 0.26, p.y + Math.sin((p.na * Math.PI) / 180) * fr * 0.26, z0]));
  } else if (style === 'gear') {
    const box = Manifold.extrude(CrossSection.square([2.4, s * 0.46], true), z1 - z0);   // sticks 1.2 mm out, 1.0 mm cut into the wall
    for (const p of pts) parts.push(box.rotate([0, 0, p.na]).translate([p.x + Math.cos((p.na * Math.PI) / 180) * 0.2, p.y + Math.sin((p.na * Math.PI) / 180) * 0.2, z0]));
  } else if (style === 'dimples') {
    const rr = Math.min(1.6, s * 0.33), rowPitch = s * 0.866, rows = Math.max(1, Math.floor((z1 - 0.5 - z0 - 2 * rr) / rowPitch) + 1), ball = Manifold.sphere(rr, 20);
    for (let row = 0; row < rows; row++) {
      const z = z0 + rr + row * rowPitch;
      for (const p of outlineSamples(side, r, n).map((q, i) => (row % 2 ? outlineSamples(side, r, n * 2)[i * 2 + 1] : q)))
        parts.push(ball.translate([p.x + Math.cos((p.na * Math.PI) / 180) * (rr - 0.9), p.y + Math.sin((p.na * Math.PI) / 180) * (rr - 0.9), z]));
    }
  } else return null;
  return Manifold.union(parts);
}

// ---------- cap ----------
export function buildCap(wasm, fonts, o) {
  const { Manifold, CrossSection } = wasm;
  const opt = Object.assign({
    text: 'YOUR TEXT', boreD: 35.3, wall: 2.6, depth: 8.0, top: 2.4,
    engrave: 0.8, grip: 'fluted', gripCount: 28, sizeFactor: 1.0,
  }, o);

  const SEG = 160;
  const square = opt.shape === 'square';
  const IR = opt.boreD / 2, OR = IR + opt.wall, H = opt.top + opt.depth;
  const CH = 1.2, LEAD = 0.8;
  if (square && !SQUARE_GRIPS.includes(opt.grip)) opt.grip = 'fluted';   // other styles need a round outline

  let body;
  if (square) {
    // Rounded-square outside (convex, so the hull of its outline at three heights is exact), rounded-square pocket cut into it.
    const so = opt.boreD + 2 * opt.wall, ro = opt.corner + opt.wall, big = roundedSquare(so, ro), small = roundedSquare(so - 2 * CH, ro - CH);
    body = Manifold.hull([...small.map(([x, y]) => [x, y, 0]), ...big.map(([x, y]) => [x, y, CH]), ...big.map(([x, y]) => [x, y, H])]);
    body = body.subtract(Manifold.extrude(new CrossSection([roundedSquare(opt.boreD, opt.corner)]), opt.depth + 1).translate([0, 0, opt.top]));
    if (opt.grip !== 'smooth') {
      const cut = squareGripCutter(wasm, opt.grip, opt.gripCount, so, ro, CH + 1.6, H + 0.5);
      if (cut) body = body.subtract(cut);
    }
  } else {
    body = Manifold.revolve(new CrossSection([[
      [0, 0], [OR - CH, 0], [OR, CH], [OR, H],
      [IR + LEAD, H], [IR, H - LEAD], [IR, opt.top], [0, opt.top],
    ]]), SEG);
    if (opt.grip !== 'smooth') {
      const cut = gripCutter(wasm, opt.grip, opt.gripCount, OR, IR, CH + 1.6, H);
      if (cut) body = body.subtract(cut);
    }
  }

  const { rings, em } = layoutText(fonts, opt.text, (square ? opt.boreD / 2 + opt.wall : IR) - 1.5, opt.sizeFactor);
  if (opt.info) opt.info.em = em;   // lets the UI warn when the text had to get very small
  if (rings.length) {
    const txt = Manifold.extrude(new CrossSection(rings, 'NonZero'), opt.engrave + 0.2).translate([0, 0, -0.2]);
    body = body.subtract(txt);
  }
  return body;
}

// ---------- mesh helpers ----------
export function manifoldToArrays(m) {
  const mesh = m.getMesh(), n = mesh.numProp, nv = mesh.vertProperties.length / n;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = mesh.vertProperties[i * n + k];
  return { pos, idx: mesh.triVerts };
}

export function toBinarySTL(pos, idx, name = 'DJI Action 5 Pro lens cap') {
  const nt = idx.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  const hdr = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, hdr.length).set(hdr);
  dv.setUint32(80, nt, true);
  let off = 84;
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const p = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const [A, B, C] = [p(a), p(b), p(c)];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...nrm) || 1; nrm = nrm.map((x) => x / l);
    for (const x of [...nrm, ...A, ...B, ...C]) { dv.setFloat32(off, x, true); off += 4; }
    dv.setUint16(off, 0, true); off += 2;
  }
  return new Uint8Array(buf);
}
