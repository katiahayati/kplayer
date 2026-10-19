// Turns the performance document's gestures (anchored to measures) into timing
// gestures (anchored to score positions). Sections get minimum ease lengths so
// they can't turn into abrupt tempo jumps; a breath spans the note before it.
// With repeats, a gesture in a repeated measure applies on every pass.

import type { TimingGesture } from './timeline';
import type { Anchor, Gesture } from './types';

/** All score positions an anchor refers to, in playback order. */
export type AnchorResolver = (a: Anchor) => number[];
/** Onset of the note a breath at q follows (see `noteBefore`). */
export type NoteBeforeResolver = (q: number, staff?: string) => number | undefined;

/** Shortest ramp, a tempo, or shape rise/fall, in quarter notes. */
export const MIN_SECTION_EASE_Q = 0.5;

export function compileGestures(gestures: Gesture[], resolve: AnchorResolver, noteBefore: NoteBeforeResolver): TimingGesture[] {
  const out: TimingGesture[] = [];
  for (const g of gestures) {
    if (g.enabled === false) continue;
    if (g.type === 'breath') {
      for (const q of resolve(g.at)) {
        const start = noteBefore(q, g.staff);
        if (start === undefined || start >= q) continue;
        out.push({ kind: 'breath', id: g.id, start, q, extraSec: Math.max(0, g.extraMs) / 1000 });
      }
      continue;
    }

    for (const [q0, end] of pairSpans(resolve(g.from), resolve(g.to))) {
      const q1 = Math.max(end, q0 + MIN_SECTION_EASE_Q);
      if (g.type === 'ramp') {
        const amount = clamp(g.amount, 0, g.dir === 'slower' ? 0.6 : 1);
        out.push({ kind: 'ramp', id: g.id, q0, q1, ratio: g.dir === 'slower' ? 1 - amount : 1 + amount });
      } else if (g.type === 'aTempo') {
        out.push({ kind: 'aTempo', id: g.id, q0, q1 });
      } else {
        const amount = clamp(g.amount, 0, g.gesture === 'broaden' ? 0.6 : 1);
        const peak = Math.max(q0 + clamp(g.peak, 0, 1) * (q1 - q0), q0 + MIN_SECTION_EASE_Q);
        const fallEnd = Math.max(q1 + Math.max(g.releaseQ, 0), peak + MIN_SECTION_EASE_Q);
        out.push({
          kind: 'shape',
          id: g.id,
          start: q0,
          peak,
          end: fallEnd,
          ratio: g.gesture === 'broaden' ? 1 - amount : 1 + amount,
        });
      }
    }
  }
  return out;
}

/**
 * Pairs the passes of a range's two ends: pass-by-pass when both ends repeat
 * the same number of times, otherwise each start with the first end after it.
 */
export function pairSpans(froms: number[], tos: number[]): [number, number][] {
  if (!froms.length || !tos.length) return [];
  if (froms.length === tos.length) return froms.map((f, i) => [f, Math.max(f, tos[i])]);
  const pairs: [number, number][] = [];
  for (const f of froms) {
    const t = tos.find((x) => x > f);
    if (t !== undefined && !pairs.some((p) => p[1] === t)) pairs.push([f, t]);
  }
  return pairs;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}
