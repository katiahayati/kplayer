// The time map: score position q (quarter notes) → performance time (seconds).
//
//   BPM(q) = B(q) · factor · e^{L(q)}        T(q) = ∫₀^q 60 / BPM(u) du
//
// B is the written tempo (piecewise constant), L is the sum of all expressive
// gestures in log-tempo space. There are no pauses: every note-on and note-off
// maps through the same T, so notes only ever stretch or compress.
//
// Every gesture is smooth. A breath is a small, local broaden: it eases down
// through the note before the breath, is slowest at the breath, and eases back
// up through the note after, so everything outside those two notes is in tempo.

import { bumpShape, rampShape } from './curves';

export interface TempoPoint {
  q: number;
  bpm: number;
}

/** Gestures with anchors already resolved to score positions. */
export type TimingGesture =
  /** Reaches `ratio` × tempo at q1 and holds it (rit. / accel.). */
  | { kind: 'ramp'; id: string; q0: number; q1: number; ratio: number }
  /** Smoothly cancels whatever ramp level is in effect, arriving at q1. */
  | { kind: 'aTempo'; id: string; q0: number; q1: number }
  /** Eases to `ratio` × tempo at `peak`, holds it until `hold`, then eases back by `end` (broaden / push forward). */
  | { kind: 'shape'; id: string; start: number; peak: number; hold: number; end: number; ratio: number }
  /**
   * Broadens [start, end] (onset of the note before the breath to the end of the
   * note after) so it takes `extraSec` longer, slowest exactly at the breath point q.
   */
  | { kind: 'breath'; id: string; start: number; q: number; end: number; extraSec: number };

export interface BreathResult {
  id: string;
  /** Tempo ratio at the breath point (e.g. 0.7 = 70% of the surrounding tempo). */
  minRatio: number;
  /** True when the requested time couldn't fit without going below MIN_BREATH_RATIO. */
  clamped: boolean;
  /** Extra time actually added, in seconds. */
  addedSec: number;
}

export interface TimeMap {
  readonly endQ: number;
  /** Performance time of endQ, in seconds. */
  readonly duration: number;
  readonly breaths: BreathResult[];
  T(q: number): number;
  qAt(t: number): number;
  bpmAt(q: number): number;
  /** Expressive multiplier e^{L(q)} on top of the written tempo. */
  ratioAt(q: number): number;
}

export interface TimeMapOptions {
  tempos: TempoPoint[];
  endQ: number;
  gestures?: TimingGesture[];
  tempoFactor?: number;
  /** Integration step in quarter notes. */
  step?: number;
}

/** A breath never slows the music below this fraction of the surrounding tempo. */
export const MIN_BREATH_RATIO = 0.25;

const DEFAULT_BPM = 120;

interface Term {
  lo: number;
  hi: number;
  /** Value for q > hi (ramps hold their level; bumps return to 0). */
  tail: number;
  at(q: number): number;
}

export function buildTimeMap(opts: TimeMapOptions): TimeMap {
  const step = opts.step ?? 1 / 64;
  const factor = opts.tempoFactor ?? 1;
  const endQ = Math.max(opts.endQ, 0);
  const tempos = normalizeTempos(opts.tempos);
  const gestures = opts.gestures ?? [];

  const tempoAt = (q: number): number => {
    let lo = 0;
    let hi = tempos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tempos[mid].q <= q) lo = mid;
      else hi = mid - 1;
    }
    return tempos[lo].bpm * factor;
  };
  // Where the tempo may jump: written tempo changes. Integration intervals never straddle these.
  const breakpoints = tempos.map((t) => t.q).filter((q) => q > 0 && q < endQ);

  const terms: Term[] = [];
  const logOffset = (q: number): number => {
    let sum = 0;
    for (const t of terms) sum += q < t.lo ? 0 : q > t.hi ? t.tail : t.at(q);
    return sum;
  };

  // Ramps and a tempos first, in order, so an a tempo knows what level to cancel.
  const rampLike = gestures
    .filter((g): g is Extract<TimingGesture, { kind: 'ramp' | 'aTempo' }> => g.kind === 'ramp' || g.kind === 'aTempo')
    .sort((a, b) => a.q0 - b.q0);
  for (const g of rampLike) {
    const level = g.kind === 'ramp' ? Math.log(g.ratio) : -logOffset(g.q1);
    terms.push({ lo: g.q0, hi: g.q1, tail: level, at: (q) => level * rampShape(q, g.q0, g.q1) });
  }

  for (const g of gestures) {
    if (g.kind !== 'shape') continue;
    const level = Math.log(g.ratio);
    terms.push({ lo: g.start, hi: g.end, tail: 0, at: (q) => level * bumpShape(q, g.start, g.peak, g.hold, g.end) });
  }

  // Breaths last: each is solved against everything already on the curve
  // (including earlier breaths), so their extra times add up exactly. The depth
  // k of the dip is found by bisection so the window takes extraSec longer.
  const breaths: BreathResult[] = [];
  const breathGestures = gestures
    .filter((g): g is Extract<TimingGesture, { kind: 'breath' }> => g.kind === 'breath')
    .sort((a, b) => a.q - b.q);
  for (const g of breathGestures) {
    const nodes = simpsonNodes(Math.max(g.start, 0), Math.min(g.end, endQ), step / 4, breakpoints);
    const base = nodes.q.map((q, i) => (nodes.w[i] * 60) / (tempoAt(q) * Math.exp(logOffset(q))));
    const shape = nodes.q.map((q) => bumpShape(q, g.start, g.q, g.q, g.end));
    const added = (k: number) => base.reduce((sum, b, i) => sum + b * Math.expm1(k * shape[i]), 0);

    const kMax = -Math.log(MIN_BREATH_RATIO);
    let k = 0;
    let clamped = false;
    if (g.extraSec > 0 && base.length) {
      if (added(kMax) <= g.extraSec) {
        k = kMax;
        clamped = true;
      } else {
        let lo = 0;
        let hi = kMax;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2;
          if (added(mid) < g.extraSec) lo = mid;
          else hi = mid;
        }
        k = (lo + hi) / 2;
      }
    }
    breaths.push({ id: g.id, minRatio: Math.exp(-k), clamped, addedSec: added(k) });
    terms.push({ lo: g.start, hi: g.end, tail: 0, at: (q) => -k * bumpShape(q, g.start, g.q, g.q, g.end) });
  }

  // Cumulative time table on a grid that includes every written tempo change,
  // so B is constant inside each interval.
  const grid = buildGrid(endQ, step, breakpoints);
  const n = grid.length;
  /** Simpson's rule over [a, b] inside one grid interval, sampling just inside its ends. */
  const simpson = (a: number, b: number): number => {
    const bpm = tempoAt((a + b) / 2);
    const e = (b - a) * 1e-9;
    const f = (q: number) => 60 / (bpm * Math.exp(logOffset(q)));
    return ((b - a) / 6) * (f(a + e) + 4 * f((a + b) / 2) + f(b - e));
  };
  const ts = new Float64Array(n);
  for (let i = 0; i + 1 < n; i++) ts[i + 1] = ts[i] + simpson(grid[i], grid[i + 1]);
  const duration = ts[n - 1];

  const intervalOf = (q: number): number => {
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (grid[mid] <= q) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const bpmAt = (q: number) => tempoAt(q) * Math.exp(logOffset(q));

  const T = (q: number): number => {
    if (n < 2) return (q * 60) / tempoAt(0);
    if (q <= 0) return (q * 60) / bpmAt(0);
    if (q >= endQ) return duration + ((q - endQ) * 60) / bpmAt(endQ);
    const i = intervalOf(q);
    const a = grid[i];
    return q === a ? ts[i] : ts[i] + simpson(a, q);
  };

  const qAt = (t: number): number => {
    if (n < 2) return (t * tempoAt(0)) / 60;
    if (t <= 0) return (t * bpmAt(0)) / 60;
    if (t >= duration) return endQ + ((t - duration) * bpmAt(endQ)) / 60;
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const span = ts[lo + 1] - ts[lo];
    const frac = span > 0 ? (t - ts[lo]) / span : 0;
    return grid[lo] + frac * (grid[lo + 1] - grid[lo]);
  };

  return {
    endQ,
    duration,
    breaths,
    T,
    qAt,
    bpmAt,
    ratioAt: (q) => Math.exp(logOffset(q)),
  };
}

function normalizeTempos(input: TempoPoint[]): TempoPoint[] {
  const sorted = input.filter((t) => t.bpm > 0).sort((a, b) => a.q - b.q);
  const out: TempoPoint[] = [];
  for (const t of sorted) {
    const q = Math.max(t.q, 0);
    if (out.length && out[out.length - 1].q === q) out[out.length - 1] = { q, bpm: t.bpm };
    else out.push({ q, bpm: t.bpm });
  }
  if (!out.length) out.push({ q: 0, bpm: DEFAULT_BPM });
  else if (out[0].q > 0) out.unshift({ q: 0, bpm: out[0].bpm });
  return out;
}

function buildGrid(endQ: number, step: number, breakpoints: number[]): Float64Array {
  const points = new Set<number>();
  const count = Math.ceil(endQ / step);
  for (let i = 0; i < count; i++) points.add(i * step);
  points.add(endQ);
  for (const b of breakpoints) points.add(b);
  return Float64Array.from([...points].sort((a, b) => a - b));
}

/** Composite Simpson nodes and weights over [lo, hi], split at breakpoints. */
function simpsonNodes(lo: number, hi: number, step: number, breakpoints: number[]): { q: number[]; w: number[] } {
  const q: number[] = [];
  const w: number[] = [];
  if (hi <= lo) return { q, w };
  const edges = [lo, ...breakpoints.filter((b) => b > lo && b < hi), hi];
  for (let e = 0; e + 1 < edges.length; e++) {
    const a = edges[e];
    const b = edges[e + 1];
    const m = Math.max(2, 2 * Math.ceil((b - a) / step / 2));
    const h = (b - a) / m;
    for (let i = 0; i <= m; i++) {
      // Nudge the segment ends inward so tempoAt picks this segment's tempo.
      const x = i === 0 ? a + h * 1e-9 : i === m ? b - h * 1e-9 : a + i * h;
      q.push(x);
      w.push(((i === 0 || i === m ? 1 : i % 2 ? 4 : 2) * h) / 3);
    }
  }
  return { q, w };
}
