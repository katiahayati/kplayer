// Turns a recording's timing (from tools/align_recording.py) into a kplayer
// performance file: a basic tempo, Speed up / Slow down sections between the
// performer's tempo turning points, and breaths where the singer's phrase ends
// take extra time. Then checks the result against the recording with the same
// timing engine the player uses.
//
// Usage: npx tsx scripts/fit-performance.ts score.mxl alignment.json out.kplayer.json ["Performer"] [curves.csv]

import fs from 'node:fs';
import { anchorAtQ, breathWindow, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { buildTimeMap, type TempoPoint } from '../src/perf/timeline';
import type { Anchor, Gesture, PerformanceDoc } from '../src/perf/types';
import { loadScoreFile } from './lib/load-score';

/** Smoothing of the measured tempo, in quarter notes (about two bars of 4/4). */
const SMOOTH_Q = 8;
/** A tempo turning point must differ from the previous one by at least this ratio. */
const TURN = Math.log(1.05);
/** Breaths shorter than this are left out. */
const MIN_BREATH_MS = 100;
/** Grid for sampling the tempo, and for placing section ends, in quarter notes. */
const STEP = 0.25;
const SNAP = 0.5;

const [scoreFile, alignmentFile, outFile, performer = 'the recording', curvesFile] = process.argv.slice(2);
if (!outFile) throw new Error('Usage: fit-performance.ts score.mxl alignment.json out.kplayer.json ["Performer"] [curves.csv]');

const score = await loadScoreFile(scoreFile);
const alignment = JSON.parse(fs.readFileSync(alignmentFile, 'utf8')) as { score: { sha256: string }; recording: string; onsets: [number, number][] };
if (alignment.score.sha256 !== score.sha256) console.warn('Warning: the alignment was made for a different version of this score.');

const interp = (x: number, xs: number[], ys: number[]): number => {
  if (x <= xs[0]) return ys[0] + (x - xs[0]) * ((ys[1] - ys[0]) / (xs[1] - xs[0]));
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last] + (x - xs[last]) * ((ys[last] - ys[last - 1]) / (xs[last] - xs[last - 1]));
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((x - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
};
const recQ = alignment.onsets.map((o) => o[0]);
const recT = alignment.onsets.map((o) => o[1]);
/** When score position q happens in the recording. */
const tRec = (q: number) => interp(q, recQ, recT);

const tempos: TempoPoint[] = score.events.tempos;
const written = (q: number) => [...tempos].reverse().find((t) => t.q <= q + 1e-9)?.bpm ?? 120;
const endQ = score.index.endQ;
// The last notes' length in the recording is their release, not tempo: measure up to the last onset.
const lastOnset = recQ[recQ.length - 2] ?? endQ;

// ---- 1. The measured tempo, as log ratio to the written tempo, smoothed ----

const grid: number[] = [];
for (let q = 0; q <= endQ + 1e-9; q += STEP) grid.push(q);
const measured = grid.map((q) => {
  const a = Math.max(0, Math.min(q, lastOnset) - 0.5);
  const b = Math.min(lastOnset, a + 1);
  return Math.log((60 * (b - a)) / (tRec(b) - tRec(a)) / written(q));
});
const half = Math.round(SMOOTH_Q / STEP / 2);
const kernel = Array.from({ length: 2 * half + 1 }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (2 * half + 2)));
const smooth = grid.map((_, i) => {
  let sum = 0;
  let weight = 0;
  kernel.forEach((k, j) => {
    const v = measured[Math.min(grid.length - 1, Math.max(0, i + j - half))];
    sum += k * v;
    weight += k;
  });
  return sum / weight;
});

// ---- 2. Basic tempo: the median, so sections describe departures from it ----

const sorted = [...smooth].sort((a, b) => a - b);
const tempoFactor = Math.round(Math.exp(sorted[sorted.length >> 1]) * 100) / 100;
const level = smooth.map((y) => y - Math.log(tempoFactor));
const levelAt = (q: number) => interp(q, grid, level);

// ---- 3. Turning points (a zigzag through the smoothed curve) ----

const turns: number[] = [0];
let pivot = 0;
let cand = 0;
let dir = 0;
for (let i = 1; i < grid.length; i++) {
  if (dir === 0) {
    if (Math.abs(level[i] - level[pivot]) >= TURN) [dir, cand] = [Math.sign(level[i] - level[pivot]), i];
  } else if (dir * (level[i] - level[cand]) > 0) {
    cand = i;
  } else if (dir * (level[cand] - level[i]) >= TURN) {
    turns.push(cand);
    [pivot, dir, cand] = [cand, -dir, i];
  }
}
if (dir !== 0) turns.push(cand);
turns.push(grid.length - 1);
let knots = [...new Set(turns.map((i) => Math.round(grid[i] / SNAP) * SNAP))].sort((a, b) => a - b);

// Where a smooth S-curve between two turning points strays from the measured
// shape by more than FIT_TOLERANCE, add a turning point at the worst spot.
const FIT_TOLERANCE = Math.log(1.1);
for (let pass = 0; pass < 20; pass++) {
  const added: number[] = [];
  for (let i = 0; i + 1 < knots.length; i++) {
    const [a, b] = [knots[i], knots[i + 1]];
    if (b - a < 2 * SNAP) continue;
    const [la, lb] = [levelAt(a), levelAt(b)];
    let worst = { q: a, err: 0 };
    for (let q = a + SNAP; q < b - 1e-9; q += STEP) {
      const u = (q - a) / (b - a);
      const err = Math.abs(levelAt(q) - (la + (lb - la) * u * u * u * (u * (u * 6 - 15) + 10)));
      if (err > worst.err) worst = { q: Math.round(q / SNAP) * SNAP, err };
    }
    if (worst.err > FIT_TOLERANCE && worst.q > a && worst.q < b) added.push(worst.q);
  }
  if (!added.length) break;
  knots = [...new Set([...knots, ...added])].sort((x, y) => x - y);
}

// ---- 4. Breaths: extra time at the singer's phrase ends ----
// Measured against the tempo just around each breath (two beats either side),
// not the smoothed curve, which averages breaths away.

const anchor = (q: number): Anchor => anchorAtQ(score.index, Math.min(q, endQ - 1e-6))!;
/** Anchors a section or breath end in the measure it ends, like the app does for a note's end. */
const endAnchor = (q: number): Anchor => {
  const a = anchorAtQ(score.index, Math.max(0, q - 1e-6))!;
  return { ...a, offsetQ: Math.round((a.offsetQ + 1e-6) * 1e6) / 1e6 };
};
let id = 0;
const gestures: Gesture[] = [];

const voiceStaff = [...score.lyrics.keys()].map((nid) => score.staffOf.get(nid)).find((s) => s) ?? '1';
const voicePart = score.events.parts.find((p) => p.tracks.includes(Number(voiceStaff) - 1)) ?? score.events.parts[0];
const tick = 1 / 120; // Verovio's MIDI ends notes a tick early
const voiceNotes = voicePart.notes.map((n) => ({ qOn: n.qOn, qOff: n.qOff + tick }));
const boundaries = new Set<number>();
// After a punctuated syllable (the end of its note, ties included)…
for (const [nid, syl] of score.lyrics) {
  if (!/[,.;:!?]['’"]?$/.test(syl)) continue;
  const q = score.index.spans.get(nid)?.[0]?.qOn;
  const note = q === undefined ? undefined : voiceNotes.find((n) => Math.abs(n.qOn - q) < 1e-6);
  if (note) boundaries.add(Math.round(note.qOff * 96) / 96);
}
// …and before every rest in the voice.
voiceNotes.forEach((n, i) => {
  const next = voiceNotes[i + 1];
  if (next && next.qOn - n.qOff >= 0.5 - 1e-6) boundaries.add(Math.round(n.qOff * 96) / 96);
});

const breathExtra: { q: number; sec: number }[] = [];
for (const q of [...boundaries].sort((a, b) => a - b)) {
  const w = breathWindow(score.staffSpans, q, voiceStaff);
  if (!w || w.start < 2 || w.end > lastOnset - 2) continue;
  const secPerQ = (tRec(w.start) - tRec(w.start - 2) + tRec(w.end + 2) - tRec(w.end)) / 4;
  const extra = tRec(w.end) - tRec(w.start) - (w.end - w.start) * secPerQ;
  if (process.env.FIT_DEBUG) console.error(`breath candidate q ${q} (window ${w.start}–${w.end}): ${Math.round(extra * 1000)} ms`);
  if (extra * 1000 < MIN_BREATH_MS) continue;
  const extraMs = Math.min(1500, Math.round(extra * 100) * 10);
  breathExtra.push({ q, sec: extraMs / 1000 });
  gestures.push({ id: `b${++id}`, type: 'breath', at: endAnchor(q), staff: voiceStaff, extraMs });
}

// ---- 5. Sections between turning points, timed to the recording ----
// Within a section the tempo eases (smootherstep) from one turning point's level
// to the next. The levels are solved so each section, plus the breaths inside
// it, takes as long as it does in the recording, staying close to the measured
// shape (damped Gauss-Newton; each section depends only on its two ends).

const segs = knots.slice(0, -1).map((k, i) => ({ a: Math.max(k, i === 0 ? SNAP : 0), b: knots[i + 1] })).filter((g) => g.b > g.a);
const nodes = [segs[0].a, ...segs.map((g) => g.b)];
const target = nodes.map(levelAt);
const recorded = segs.map((g) => tRec(g.b) - tRec(g.a) - breathExtra.filter((x) => x.q > g.a && x.q <= g.b).reduce((s, x) => s + x.sec, 0));
// Past the last onset the recording only shows the final chord's release, which isn't tempo.
const timed = segs.map((g) => (g.b <= lastOnset + 1e-9 ? 1 : 0));
const smoothstep = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
/** A section's duration for end levels za, zb, and its derivatives with respect to them. */
const segment = (g: { a: number; b: number }, za: number, zb: number) => {
  const n = 64;
  const h = (g.b - g.a) / n;
  let d = 0;
  let dA = 0;
  let dB = 0;
  for (let j = 0; j <= n; j++) {
    const q = g.a + j * h;
    const S = smoothstep(j / n);
    const w = ((j === 0 || j === n ? 1 : j % 2 ? 4 : 2) * h) / 3;
    const c = (w * 60) / (written(q) * tempoFactor * Math.exp(za + (zb - za) * S));
    d += c;
    dA -= c * (1 - S);
    dB -= c * S;
  }
  return { d, dA, dB };
};
const LAMBDA = 4; // seconds² per (log tempo)²: how strongly levels stay near the measured shape
/** Levels never move further than this from the measured curve (log tempo). */
const MAX_SHIFT = Math.log(1.15);
const z = [...target];
for (let iter = 0; iter < 30; iter++) {
  const n = z.length;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const rhs = new Array<number>(n).fill(0);
  segs.forEach((g, i) => {
    const { d, dA: a0, dB: b0 } = segment(g, z[i], z[i + 1]);
    const [dA, dB] = [a0 * timed[i], b0 * timed[i]];
    const r = (d - recorded[i]) * timed[i];
    A[i][i] += dA * dA;
    A[i][i + 1] += dA * dB;
    A[i + 1][i] += dA * dB;
    A[i + 1][i + 1] += dB * dB;
    rhs[i] -= dA * r;
    rhs[i + 1] -= dB * r;
  });
  for (let k = 0; k < n; k++) {
    A[k][k] += LAMBDA;
    rhs[k] -= LAMBDA * (z[k] - target[k]);
  }
  const step = solve(A, rhs);
  z.forEach((_, k) => (z[k] = Math.max(target[k] - MAX_SHIFT, Math.min(target[k] + MAX_SHIFT, z[k] + Math.max(-0.2, Math.min(0.2, step[k]))))));
  if (Math.max(...step.map(Math.abs)) < 1e-6) break;
}

if (process.env.FIT_DEBUG) {
  segs.forEach((g, i) => {
    const { d } = segment(g, z[i], z[i + 1]);
    console.error(`seg ${g.a}→${g.b}: fitted ${d.toFixed(2)} s, recorded ${recorded[i].toFixed(2)} s, levels ${Math.exp(z[i]).toFixed(3)}→${Math.exp(z[i + 1]).toFixed(3)} (target ${Math.exp(target[i + 1]).toFixed(3)})`);
  });
}

const section = (q0: number, q1: number, ratio: number) => {
  if (Math.abs(Math.log(ratio)) < 0.005) return;
  gestures.push({
    id: `s${++id}`,
    type: 'ramp',
    dir: ratio < 1 ? 'slower' : 'faster',
    from: anchor(q0),
    to: endAnchor(q1),
    amount: Math.round(Math.abs(ratio - 1) * 1e5) / 1e5,
  });
};
// Settle into the opening tempo over the first half beat, then follow the turning points.
section(0, nodes[0], Math.exp(z[0]));
segs.forEach((g, i) => section(g.a, g.b, Math.exp(z[i + 1] - z[i])));

const spansFor = (g: Gesture[]) =>
  compileGestures(
    g,
    (a) => resolveAnchor(score.index, a),
    (q, staff) => breathWindow(score.staffSpans, q, staff),
  );
const mapOf = (g: Gesture[]) => buildTimeMap({ tempos, endQ, gestures: spansFor(g), tempoFactor });
const sectionsOnly = gestures.filter((g) => g.type !== 'breath');

// ---- 6. Check against the recording ----

const report = (name: string, map: ReturnType<typeof mapOf>) => {
  const q0 = recQ[0];
  const errs = recQ.slice(0, -1).map((q) => map.T(q) - map.T(q0) - (tRec(q) - tRec(q0)));
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const pct = (p: number) => abs[Math.floor(p * (abs.length - 1))];
  return `${name.padEnd(28)} median ${pct(0.5).toFixed(2)} s, 90% within ${pct(0.9).toFixed(2)} s, worst ${pct(1).toFixed(2)} s, at the end ${errs[errs.length - 1].toFixed(2)} s`;
};
const finalMap = mapOf(gestures);
if (process.env.FIT_DEBUG) {
  const sm = mapOf(sectionsOnly);
  segs.forEach((g, i) => {
    const { d } = segment(g, z[i], z[i + 1]);
    const eng = sm.T(g.b) - sm.T(g.a);
    if (Math.abs(eng - d) > 0.05 || Math.abs(d - recorded[i]) > 0.2) {
      console.error(`seg ${g.a}→${g.b}: engine ${eng.toFixed(2)} s, fit model ${d.toFixed(2)} s, recorded ${recorded[i].toFixed(2)} s, ratio ${Math.exp(z[i + 1] - z[i]).toFixed(3)}`);
    }
  });
}
console.error(`basic tempo ♩ = ${(60 * tempoFactor).toFixed(0)} (written ${written(0)}): ${sectionsOnly.length} sections, ${breathExtra.length} breaths`);
console.error('timing vs the recording, at every note onset:');
console.error('  ' + report('written tempo only', buildTimeMap({ tempos, endQ })));
console.error('  ' + report('basic tempo only', buildTimeMap({ tempos, endQ, tempoFactor })));
console.error('  ' + report('+ sections', mapOf(sectionsOnly)));
console.error('  ' + report('+ sections + breaths', finalMap));

const doc: PerformanceDoc & { source: string } = {
  version: 1,
  source: `Fitted to ${performer} (${alignment.recording}) by kplayer's recording aligner`,
  score: { name: score.name, sha256: score.sha256 },
  tempoFactor,
  parts: {},
  gestures,
};
fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
console.error(`wrote ${outFile}`);

if (curvesFile) {
  const rows = grid.map((q, i) => [q, written(q) * Math.exp(measured[i]), written(q) * Math.exp(smooth[i]), finalMap.bpmAt(q)].map((v) => v.toFixed(3)).join(','));
  fs.writeFileSync(curvesFile, ['q,measured,smoothed,model', ...rows].join('\n') + '\n');
}

/** Solves A x = b by Gaussian elimination with partial pivoting (small dense systems). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let k = r + 1; k < n; k++) sum -= M[r][k] * x[k];
    x[r] = sum / M[r][r];
  }
  return x;
}
