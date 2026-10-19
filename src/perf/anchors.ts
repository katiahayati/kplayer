// Maps between the score as notated (measures, element IDs) and the score as
// played (positions q in quarter notes). Verovio expands repeats: a measure or
// note played twice appears in the timemap once per pass, with "-rend2",
// "-rend3"… appended to its ID. The SVG only carries the base IDs.

import type { Anchor } from './types';

export interface TimemapEntry {
  tstamp: number;
  qstamp: number;
  tempo?: number;
  measureOn?: string;
  on?: string[];
  off?: string[];
  restsOn?: string[];
  restsOff?: string[];
}

export interface Span {
  qOn: number;
  qOff: number;
}

export interface MeasureInfo {
  /** Base element ID. */
  id: string;
  /** Printed measure number. */
  label: string;
  /** Start position of each pass through this measure. */
  starts: number[];
}

export interface PlayedMeasure {
  measureIndex: number;
  q0: number;
  q1: number;
}

export interface ScoreIndex {
  /** In score (document) order. */
  measures: MeasureInfo[];
  measureIndexById: Map<string, number>;
  /** In playback order, repeats expanded. */
  played: PlayedMeasure[];
  /** Note and rest spans by base ID, one per pass, in playback order. */
  spans: Map<string, Span[]>;
  /** Base ID → measure index. */
  measureOf: Map<string, number>;
  endQ: number;
}

export const baseId = (id: string): string => id.replace(/-rend\d+$/, '');

export function buildScoreIndex(timemap: TimemapEntry[], labelOf: (measureId: string) => string, endQ?: number): ScoreIndex {
  const measures: MeasureInfo[] = [];
  const measureIndexById = new Map<string, number>();
  const played: PlayedMeasure[] = [];
  const open = new Map<string, number>();
  const spans = new Map<string, Span[]>();
  const measureOf = new Map<string, number>();
  let current = -1;
  let last = 0;

  for (const e of timemap) {
    last = Math.max(last, e.qstamp);
    if (e.measureOn) {
      const id = baseId(e.measureOn);
      let index = measureIndexById.get(id);
      if (index === undefined) {
        index = measures.length;
        measures.push({ id, label: labelOf(id) || String(index + 1), starts: [] });
        measureIndexById.set(id, index);
      }
      measures[index].starts.push(e.qstamp);
      if (played.length) played[played.length - 1].q1 = e.qstamp;
      played.push({ measureIndex: index, q0: e.qstamp, q1: e.qstamp });
      current = index;
    }
    for (const id of [...(e.off ?? []), ...(e.restsOff ?? [])]) {
      const start = open.get(id);
      if (start === undefined) continue;
      open.delete(id);
      const base = baseId(id);
      let list = spans.get(base);
      if (!list) spans.set(base, (list = []));
      list.push({ qOn: start, qOff: e.qstamp });
    }
    for (const id of [...(e.on ?? []), ...(e.restsOn ?? [])]) {
      open.set(id, e.qstamp);
      if (current >= 0 && !measureOf.has(baseId(id))) measureOf.set(baseId(id), current);
    }
  }
  const end = Math.max(endQ ?? 0, last);
  if (played.length) played[played.length - 1].q1 = end;
  for (const list of spans.values()) list.sort((a, b) => a.qOn - b.qOn);
  return { measures, measureIndexById, played, spans, measureOf, endQ: end };
}

/** Every score position this anchor refers to (one per pass through its measure). */
export function resolveAnchor(index: ScoreIndex, a: Anchor): number[] {
  const m = index.measures[a.measureIndex];
  return m ? m.starts.map((s) => s + a.offsetQ) : [];
}

/** The anchor for a position inside a given measure. */
export function anchorFor(index: ScoreIndex, measureIndex: number, q: number): Anchor {
  const m = index.measures[measureIndex];
  // Pick the pass this q belongs to, so the offset is relative to the right start.
  const start = m ? m.starts.filter((s) => s <= q + 1e-9).pop() ?? m.starts[0] : 0;
  return { measureIndex, offsetQ: round(q - start), label: m?.label };
}

/** The anchor for a position in playback order. */
export function anchorAtQ(index: ScoreIndex, q: number): Anchor | undefined {
  const pm = playedMeasureAt(index, q);
  return pm ? anchorFor(index, pm.measureIndex, q) : undefined;
}

export function playedMeasureAt(index: ScoreIndex, q: number): PlayedMeasure | undefined {
  let lo = 0;
  let hi = index.played.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.played[mid].q0 <= q + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return index.played[lo];
}

/** One measure before through one measure after the given range, in playback order. */
export function loopAround(index: ScoreIndex, q0: number, q1: number): { q0: number; q1: number } {
  const first = playedMeasureAt(index, q0);
  const lastM = playedMeasureAt(index, Math.max(q0, q1 - 1e-6));
  if (!first || !lastM) return { q0, q1 };
  const i = index.played.indexOf(first);
  const j = index.played.indexOf(lastM);
  return {
    q0: index.played[Math.max(0, i - 1)].q0,
    q1: index.played[Math.min(index.played.length - 1, j + 1)].q1,
  };
}

/**
 * Onset of the note a breath at q follows: the latest-starting note or rest in
 * `staff` that sounds into q. Without a staff, every staff is considered.
 */
export function noteBefore(staffSpans: Map<string, Span[]>, q: number, staff?: string): number | undefined {
  const lists = staff !== undefined && staffSpans.has(staff) ? [staffSpans.get(staff)!] : [...staffSpans.values()];
  let best: number | undefined;
  for (const list of lists) {
    for (const s of list) {
      if (s.qOn < q - 1e-6 && s.qOff > q - 1e-6 && (best === undefined || s.qOn > best)) best = s.qOn;
    }
  }
  return best;
}

/** The pass of a note closest to a reference position (e.g. the playhead). */
export function nearestSpan(spans: Span[] | undefined, q: number): Span | undefined {
  if (!spans?.length) return undefined;
  return spans.reduce((best, s) => (Math.abs(s.qOn - q) < Math.abs(best.qOn - q) ? s : best));
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
