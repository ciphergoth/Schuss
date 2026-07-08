// COURSE MAP: a top-down SVG of the whole designed course — the designer's
// drafting table. Renders the floor ribbon, centerline, golden path, every
// feature (lips, stars, gates, obstacles, coins, creatures, galleries),
// the landmarks, and the section/zone structure, split into rows so 3.6km
// reads like sheet music. Run with `pnpm map > course-map.svg`.
import { GRAND_TOUR } from '../src/sim/design';
import {
  CHUNK_LENGTH,
  COURSE_LENGTH,
  FINISH_APRON,
  SECTION_LENGTH,
  Terrain,
} from '../src/sim/terrain';

const t = new Terrain(1, COURSE_LENGTH, GRAND_TOUR);

const ROWS = 4;
const ROW_M = 950; // meters of course per row
const PX = 1.45; // px per meter along-course
const LAT = 3.0; // px per meter lateral (exaggerated for readability)
const ROW_H = 250;
const PAD = 40;
const W = ROW_M * PX + PAD * 2;
const H = ROWS * ROW_H + PAD;

const out: string[] = [];
out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,monospace">`
);
out.push(`<rect width="${W}" height="${H}" fill="#10132b"/>`);

// Map a course position (at meters, lateral x meters) to SVG coordinates.
function pt(at: number, x: number): [number, number] {
  const row = Math.min(ROWS - 1, Math.floor(at / ROW_M));
  const px = PAD + (at - row * ROW_M) * PX;
  const py = row * ROW_H + ROW_H / 2 + (x - t.centerX(-at)) * 0 + x * 0; // lateral resolved below
  return [px, py];
}

// Lateral positions are drawn RELATIVE to the centerline (the ribbon is
// unrolled straight), so widths and offsets read exactly; the wander is
// drawn separately as a thin trend line above each row.
function rel(at: number, offset: number): [number, number] {
  const row = Math.min(ROWS - 1, Math.floor(at / ROW_M));
  return [PAD + (at - row * ROW_M) * PX, row * ROW_H + ROW_H / 2 + offset * LAT];
}

// Floor ribbon + walls band per row. Sample strictly INSIDE the row (the
// row-mapping in rel() wraps at exact boundaries).
for (let row = 0; row < ROWS; row++) {
  const a0 = row * ROW_M;
  const a1 = Math.min(a0 + ROW_M - 0.01, 3800);
  let floorTop = '';
  let floorBot = '';
  let wanderLine = '';
  for (let at = a0; at <= a1; at += 4) {
    const half = t.channelHalfWidth(-at);
    const [x, yT] = rel(at, -half);
    const [, yB] = rel(at, half);
    floorTop += `${floorTop ? 'L' : 'M'}${x.toFixed(1)},${yT.toFixed(1)}`;
    floorBot = `L${x.toFixed(1)},${yB.toFixed(1)}` + floorBot;
    const wander = t.centerX(-at);
    wanderLine += `${wanderLine ? 'L' : 'M'}${x.toFixed(1)},${(row * ROW_H + 30 - wander * 0.8).toFixed(1)}`;
  }
  out.push(`<path d="${floorTop}${floorBot}Z" fill="#232a55" stroke="#3a4488"/>`);
  // The real wander (centerline world-x) as a trend strip above the ribbon.
  out.push(`<path d="${wanderLine}" fill="none" stroke="#556" stroke-width="1"/>`);
  // The golden path over the floor.
  let plan = '';
  for (let at = a0; at <= a1; at += 4) {
    const [x, y] = rel(at, t.planOffset(-at));
    plan += `${plan ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  out.push(`<path d="${plan}" fill="none" stroke="#7dff5a" stroke-width="0.8" opacity="0.5"/>`);
}

// Section boundaries + names, zone boundaries.
const SECTION_NAMES = GRAND_TOUR.sections;
for (let s = 0; s <= 9; s++) {
  const at = s * SECTION_LENGTH;
  const [x, y] = rel(at, 0);
  const row = Math.min(ROWS - 1, Math.floor(at / ROW_M));
  out.push(
    `<line x1="${x}" y1="${row * ROW_H + 45}" x2="${x}" y2="${row * ROW_H + ROW_H - 15}" stroke="#8a93d8" stroke-dasharray="4 3"/>`
  );
  if (s < 9) {
    const [lx] = rel(at + 12, 0);
    out.push(
      `<text x="${lx}" y="${row * ROW_H + 58}" fill="#aab3f0" font-size="13" font-weight="bold">${s}:${SECTION_NAMES[s]}</text>`
    );
  }
  void y;
}
for (let zn = 0; zn < 8; zn++) {
  const at = zn * 450;
  const [x] = rel(at, 0);
  const row = Math.min(ROWS - 1, Math.floor(at / ROW_M));
  out.push(
    `<text x="${x + 2}" y="${row * ROW_H + ROW_H - 4}" fill="#667" font-size="10">◐ ${GRAND_TOUR.zones[zn]}</text>`
  );
}

// Landmarks as shaded bands.
function band(a0: number, a1: number, color: string, label: string): void {
  const row = Math.min(ROWS - 1, Math.floor(a0 / ROW_M));
  const [x0] = rel(a0, 0);
  const [x1] = rel(Math.min(a1, (row + 1) * ROW_M), 0);
  out.push(
    `<rect x="${x0}" y="${row * ROW_H + 65}" width="${x1 - x0}" height="${ROW_H - 90}" fill="${color}" opacity="0.22"/>`
  );
  out.push(
    `<text x="${x0}" y="${row * ROW_H + 78}" fill="${color}" font-size="11">${label}</text>`
  );
}
band(GRAND_TOUR.waterfallAt, GRAND_TOUR.waterfallAt + 16, '#6cd0ff', 'WATERFALL');
band(GRAND_TOUR.cascadesAt, GRAND_TOUR.cascadesAt + 70, '#6cd0ff', 'CASCADES');
band(GRAND_TOUR.grottoAt, GRAND_TOUR.grottoAt + 90, '#b96bff', 'GROTTO');
band(COURSE_LENGTH - FINISH_APRON, COURSE_LENGTH, '#ffffff', 'APRON');

// Features.
for (const j of GRAND_TOUR.jumps) {
  const [x, y] = rel(j.at, j.x);
  const size = j.kind === 'XL' ? 9 : j.kind === 'L' ? 7.5 : j.kind === 'M' ? 6 : 4.5;
  const color = j.pair ? '#7dff5a' : j.hip ? '#ff8b1a' : j.stepDown ? '#ff3ddc' : '#2ee6ff';
  out.push(
    `<path d="M${x},${y - size}L${x + size},${y + size}L${x - size},${y + size}Z" fill="${color}"/>`
  );
  const tag =
    j.kind + (j.stepDown ? '↓' : '') + (j.hip ? '⤺' : '') + (j.pair ? `·${j.pair[0]}` : '');
  out.push(`<text x="${x - 8}" y="${y - size - 3}" fill="${color}" font-size="10">${tag}</text>`);
  let starTag = '';
  for (const s of j.stars) starTag += s.mult === 5 ? '★5' : '★3';
  if (starTag)
    out.push(
      `<text x="${x - 8}" y="${y + size + 11}" fill="#ffd34d" font-size="10">${starTag} ${j.stars.map((s) => s.demand).join('/')}</text>`
    );
}
// Computed star positions (the arcs' truth, not the wish).
for (let i = 0; i < COURSE_LENGTH / CHUNK_LENGTH; i++) {
  for (const b of t.bonusesForChunk(i)) {
    const [x, y] = rel(-b.z, b.x - t.centerX(b.z));
    const c = b.mult === 5 ? '#ff3ddc' : '#ffd34d';
    out.push(`<circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="${c}" stroke-width="1.6"/>`);
  }
  for (const g of t.gatesForChunk(i)) {
    const [x, y] = rel(-g.z, g.x - t.centerX(g.z));
    out.push(
      `<line x1="${x}" y1="${y - g.halfGap * LAT}" x2="${x}" y2="${y + g.halfGap * LAT}" stroke="#5df2ff" stroke-width="2.4"/>`
    );
  }
}
for (const o of GRAND_TOUR.obstacles) {
  const [x, y] = rel(o.at, o.x);
  out.push(`<rect x="${x - 2.5}" y="${y - 2.5}" width="5" height="5" fill="#ff6a5a"/>`);
}
for (const c of GRAND_TOUR.coins) {
  for (let k = 0; k < c.n; k++) {
    const [x, y] = rel(c.at + k * 3, c.x);
    out.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="#ffd34d"/>`);
  }
}
const CREATURE_GLYPH: Record<string, string> = {
  drone: '✛',
  wyrm: '∿',
  jelly: '☂',
  tumbler: '◇',
  yeti: 'Y',
};
for (const h of GRAND_TOUR.hazards) {
  const [x, y] = rel(h.at, 0);
  out.push(
    `<line x1="${x}" y1="${y - h.amp * LAT}" x2="${x}" y2="${y + h.amp * LAT}" stroke="#ffb02e" stroke-width="1" stroke-dasharray="2 2"/>`
  );
  out.push(
    `<text x="${x - 4}" y="${y + 4}" fill="#ffb02e" font-size="13" font-weight="bold">${CREATURE_GLYPH[h.kind]}</text>`
  );
  out.push(
    `<text x="${x - 10}" y="${y + h.amp * LAT + 12}" fill="#ffb02e" font-size="9">${h.kind}</text>`
  );
}
for (const g of GRAND_TOUR.galleries) {
  const half = t.channelHalfWidth(-g.at);
  const [x, y] = rel(g.at, g.side * (half + 4));
  out.push(`<text x="${x - 5}" y="${y + 4}" fill="#ff9df0" font-size="11">☺☺☺</text>`);
}

// Distance ruler.
for (let at = 0; at <= 3600; at += 100) {
  const [x, y] = rel(at, 0);
  const row = Math.min(ROWS - 1, Math.floor(at / ROW_M));
  out.push(
    `<line x1="${x}" y1="${row * ROW_H + 40}" x2="${x}" y2="${row * ROW_H + 45}" stroke="#556"/>`
  );
  if (at % 200 === 0)
    out.push(`<text x="${x - 10}" y="${row * ROW_H + 38}" fill="#667" font-size="9">${at}</text>`);
  void y;
}

out.push('</svg>');
// eslint-disable-next-line no-console
console.log(out.join('\n'));
