import { describe, expect, it } from 'vitest';
import { compileGestures } from '../../src/perf/compile';
import type { Anchor, Gesture } from '../../src/perf/types';

// Measures of 4 quarters, no repeats: measure m starts at 4m.
const resolve = (a: Anchor) => [a.measureIndex * 4 + a.offsetQ];
const none = () => undefined;
const at = (q: number): Anchor => ({ measureIndex: Math.floor(q / 4), offsetQ: q % 4 });

describe('shape compilation', () => {
  const base: Gesture = { id: 's', type: 'shape', gesture: 'push', from: at(60), to: at(80), amount: 0.12, peak: 0.5, releaseQ: 0 };

  it('uses the peak percentage when no note is picked', () => {
    expect(compileGestures([base], resolve, none)).toEqual([{ kind: 'shape', id: 's', start: 60, peak: 70, hold: 70, end: 80, ratio: 1.12 }]);
  });

  it('peaks on the picked note and holds until the hold note', () => {
    const g: Gesture = { ...base, peakAt: at(68), holdUntil: at(73.5) };
    expect(compileGestures([g], resolve, none)).toEqual([{ kind: 'shape', id: 's', start: 60, peak: 68, hold: 73.5, end: 80, ratio: 1.12 }]);
  });

  it('ignores a hold note before the peak and keeps a falling edge after the hold', () => {
    const early: Gesture = { ...base, peakAt: at(68), holdUntil: at(64) };
    expect(compileGestures([early], resolve, none)[0]).toMatchObject({ peak: 68, hold: 68 });
    const late: Gesture = { ...base, peakAt: at(68), holdUntil: at(80) };
    expect(compileGestures([late], resolve, none)[0]).toMatchObject({ hold: 80, end: 80.5 });
  });
});
