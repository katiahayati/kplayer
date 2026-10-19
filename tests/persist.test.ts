// Version 1 files stored each Slow down / Speed up relative to the tempo before
// it; version 2 stores where it arrives, relative to the basic tempo. Old files
// and saved phrasing must load and play exactly as before.

import { describe, expect, it } from 'vitest';
import { compileGestures } from '../src/perf/compile';
import { buildTimeMap } from '../src/perf/timeline';
import type { Anchor } from '../src/perf/types';
import { parseDoc } from '../src/storage/persist';

// Measures of 4 quarters: measure m starts at 4m.
const resolve = (a: Anchor) => [a.measureIndex * 4 + a.offsetQ];
const m = (measureIndex: number): Anchor => ({ measureIndex, offsetQ: 0 });

const v1 = {
  version: 1,
  tempoFactor: 1,
  parts: {},
  // Deliberately out of order: the conversion walks them in score order.
  gestures: [
    { id: 'r4', type: 'ramp', dir: 'slower', from: m(14), to: m(15), amount: 0.1 },
    { id: 'r1', type: 'ramp', dir: 'slower', from: m(1), to: m(2), amount: 0.2 },
    { id: 'r2', type: 'ramp', dir: 'faster', from: m(4), to: m(5), amount: 0.1 },
    { id: 'a', type: 'aTempo', from: m(8), to: m(9) },
    { id: 'b', type: 'breath', at: m(9), extraMs: 300 },
    { id: 'r3', type: 'ramp', dir: 'slower', from: m(10), to: m(11), amount: 0.15 },
    { id: 'off', type: 'ramp', dir: 'faster', from: m(12), to: m(13), amount: 0.5, enabled: false },
  ],
};

describe('loading version 1 files', () => {
  const doc = parseDoc(JSON.stringify(v1));
  const target = (id: string) => {
    const g = doc.gestures.find((x) => x.id === id);
    return g?.type === 'ramp' ? g.target : undefined;
  };

  it('turns relative changes into targets relative to the basic tempo', () => {
    expect(doc.version).toBe(2);
    expect(target('r1')).toBeCloseTo(0.8, 9);
    expect(target('r2')).toBeCloseTo(0.88, 9);
    // After an a tempo, back to relative to the basic tempo.
    expect(target('r3')).toBeCloseTo(0.85, 9);
    // A switched-off section keeps its own change for when it's switched on, but doesn't move the rest.
    expect(target('off')).toBeCloseTo(0.85 * 1.5, 9);
    expect(target('r4')).toBeCloseTo(0.765, 9);
    expect(doc.gestures.find((g) => g.id === 'r1')).not.toHaveProperty('dir');
    expect(doc.gestures.find((g) => g.id === 'r1')).not.toHaveProperty('amount');
  });

  it('plays the tempo the old file did', () => {
    const map = buildTimeMap({ tempos: [{ q: 0, bpm: 100 }], endQ: 80, gestures: compileGestures(doc.gestures, resolve, () => undefined) });
    const expected: [number, number][] = [[2, 100], [12, 80], [24, 88], [38, 100], [48, 85], [56, 85], [70, 76.5]];
    for (const [q, bpm] of expected) expect(map.bpmAt(q)).toBeCloseTo(bpm, 6);
  });

  it('leaves version 2 files alone', () => {
    expect(parseDoc(JSON.stringify(doc))).toEqual(doc);
  });
});
