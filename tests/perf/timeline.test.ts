import { describe, expect, it } from 'vitest';
import { buildTimeMap, MIN_BREATH_RATIO, type TimingGesture } from '../../src/perf/timeline';

const flat = (bpm: number, endQ: number, gestures: TimingGesture[] = []) =>
  buildTimeMap({ tempos: [{ q: 0, bpm }], endQ, gestures });

/** Largest change in BPM between neighbouring samples, and in its slope. */
function roughness(map: ReturnType<typeof flat>, from: number, to: number, d = 1 / 512) {
  let maxStep = 0;
  let maxCurve = 0;
  let prev = map.bpmAt(from);
  let prevStep = 0;
  for (let q = from + d; q <= to; q += d) {
    const cur = map.bpmAt(q);
    const s = cur - prev;
    maxStep = Math.max(maxStep, Math.abs(s));
    maxCurve = Math.max(maxCurve, Math.abs(s - prevStep));
    prev = cur;
    prevStep = s;
  }
  return { maxStep, maxCurve };
}

describe('identity time map', () => {
  it('matches constant tempo exactly', () => {
    const map = flat(90, 64);
    for (const q of [0, 1, 3.25, 17.5, 64]) expect(map.T(q)).toBeCloseTo((q * 60) / 90, 9);
    expect(map.duration).toBeCloseTo((64 * 60) / 90, 9);
  });

  it('honours written tempo changes', () => {
    const map = buildTimeMap({ tempos: [{ q: 0, bpm: 60 }, { q: 4, bpm: 120 }, { q: 10 / 3, bpm: 90 }], endQ: 8 });
    expect(map.T(10 / 3)).toBeCloseTo(10 / 3, 9);
    expect(map.T(4)).toBeCloseTo(10 / 3 + ((4 - 10 / 3) * 60) / 90, 9);
    expect(map.T(8)).toBeCloseTo(map.T(4) + 2, 9);
  });

  it('applies the global tempo factor', () => {
    const map = buildTimeMap({ tempos: [{ q: 0, bpm: 100 }], endQ: 10, tempoFactor: 0.5 });
    expect(map.duration).toBeCloseTo(12, 9);
  });

  it('inverts', () => {
    const map = flat(72, 40, [{ kind: 'ramp', id: 'r', q0: 8, q1: 16, ratio: 0.8 }]);
    for (let q = 0; q <= 40; q += 0.37) expect(map.qAt(map.T(q))).toBeCloseTo(q, 4);
  });
});

describe('ramps and a tempo', () => {
  it('reaches and holds the target tempo smoothly', () => {
    const map = flat(100, 32, [{ kind: 'ramp', id: 'r', q0: 8, q1: 12, ratio: 0.85 }]);
    expect(map.bpmAt(7.9)).toBeCloseTo(100, 9);
    expect(map.bpmAt(12)).toBeCloseTo(85, 9);
    expect(map.bpmAt(20)).toBeCloseTo(85, 9);
    const { maxStep, maxCurve } = roughness(map, 6, 14);
    expect(maxStep).toBeLessThan(0.05);
    expect(maxCurve).toBeLessThan(1e-4);
  });

  it('a tempo returns exactly to the written tempo', () => {
    const map = flat(100, 40, [
      { kind: 'ramp', id: 'r1', q0: 4, q1: 8, ratio: 0.8 },
      { kind: 'ramp', id: 'r2', q0: 10, q1: 12, ratio: 0.9 },
      { kind: 'aTempo', id: 'a', q0: 16, q1: 18 },
    ]);
    expect(map.bpmAt(14)).toBeCloseTo(72, 9);
    expect(map.bpmAt(18)).toBeCloseTo(100, 9);
    expect(map.bpmAt(30)).toBeCloseTo(100, 9);
    // Steepest point of a 28 BPM smootherstep over 2 quarters ≈ 26 BPM/quarter ≈ 0.05 per 1/512 step;
    // a jump would be ~28 in a single step.
    expect(roughness(map, 14, 20).maxStep).toBeLessThan(0.1);
  });
});

describe('phrase shapes', () => {
  it('broadens to the peak and returns', () => {
    const map = flat(80, 32, [{ kind: 'shape', id: 's', start: 8, peak: 10.6, hold: 10.6, end: 12, ratio: 0.9 }]);
    expect(map.bpmAt(8)).toBeCloseTo(80, 9);
    expect(map.bpmAt(10.6)).toBeCloseTo(72, 9);
    expect(map.bpmAt(12)).toBeCloseTo(80, 9);
    let minQ = 0;
    let min = Infinity;
    for (let q = 8; q <= 12; q += 1 / 128) if (map.bpmAt(q) < min) [min, minQ] = [map.bpmAt(q), q];
    expect(minQ).toBeCloseTo(10.6, 1);
    expect(roughness(map, 7, 13).maxCurve).toBeLessThan(1e-3);
  });

  it('overlapping gestures multiply (add in log space)', () => {
    const map = flat(100, 32, [
      { kind: 'shape', id: 's1', start: 4, peak: 8, hold: 8, end: 12, ratio: 1.1 },
      { kind: 'ramp', id: 'r', q0: 2, q1: 6, ratio: 0.8 },
    ]);
    expect(map.bpmAt(8)).toBeCloseTo(100 * 1.1 * 0.8, 9);
  });

  it('a phrase peaking at its end flows into the next without a step', () => {
    const map = flat(90, 32, [
      { kind: 'shape', id: 's1', start: 4, peak: 12, hold: 12, end: 13, ratio: 0.88 },
      { kind: 'shape', id: 's2', start: 12, peak: 15, hold: 15, end: 16, ratio: 1.08 },
    ]);
    const { maxStep, maxCurve } = roughness(map, 3, 17);
    expect(maxStep).toBeLessThan(0.05);
    expect(maxCurve).toBeLessThan(2e-3);
  });
});

describe('shapes with a held peak', () => {
  it('arrives at the peak, holds it level, then eases back', () => {
    const map = flat(60, 40, [{ kind: 'shape', id: 's', start: 4, peak: 12, hold: 17.5, end: 24, ratio: 1.12 }]);
    expect(map.bpmAt(4)).toBeCloseTo(60, 9);
    for (const q of [12, 13, 15, 17.5]) expect(map.bpmAt(q)).toBeCloseTo(67.2, 9);
    expect(map.bpmAt(20)).toBeGreaterThan(60);
    expect(map.bpmAt(20)).toBeLessThan(67.2);
    expect(map.bpmAt(24)).toBeCloseTo(60, 9);
    const { maxStep, maxCurve } = roughness(map, 3, 25);
    expect(maxStep).toBeLessThan(0.05);
    expect(maxCurve).toBeLessThan(1e-3);
  });
});

describe('breaths', () => {
  /** A breath at q after a note that started at `start`. */
  const breath = (q: number, extraSec: number, start = q - 1): TimingGesture => ({ kind: 'breath', id: `b${q}`, start, q, extraSec });

  it('holds the note before the breath exactly the requested time longer', () => {
    const plain = flat(72, 48);
    const map = flat(72, 48, [breath(16, 0.3)]);
    expect(map.duration - plain.duration).toBeCloseTo(0.3, 6);
    expect(map.T(16) - map.T(15) - (plain.T(16) - plain.T(15))).toBeCloseTo(0.3, 6);
    // Everything from the next note on is shifted by exactly the extra time...
    for (const q of [16, 16.5, 17, 20, 47]) expect(map.T(q) - plain.T(q)).toBeCloseTo(0.3, 6);
    // ...and nothing up to the note before the breath moves.
    for (const q of [0, 10, 14.5, 15]) expect(map.T(q)).toBeCloseTo(plain.T(q), 9);
    expect(map.breaths[0]).toMatchObject({ id: 'b16', clamped: false });
    expect(map.breaths[0].addedSec).toBeCloseTo(0.3, 9);
  });

  it('slows evenly during that note only: in tempo before it and from the next note', () => {
    const map = flat(72, 48, [breath(16, 0.3, 14.5)]);
    for (let q = 0; q <= 48; q += 1 / 64) {
      const inside = q > 14.5 + 1e-9 && q < 16 - 1e-9;
      if (inside) expect(map.bpmAt(q)).toBeCloseTo(72 * map.breaths[0].minRatio, 9);
      else if (q < 14.5 - 1e-9 || q > 16 + 1e-9) expect(map.bpmAt(q)).toBeCloseTo(72, 9);
    }
    // 1.5 quarters at 72 BPM = 1.25 s, held 0.3 s longer.
    expect(map.breaths[0].minRatio).toBeCloseTo(1.25 / 1.55, 9);
  });

  it('never shortens any note: every duration is at least as long as without the breath', () => {
    const plain = flat(96, 32);
    const map = flat(96, 32, [breath(12, 0.45, 10)]);
    for (let qOn = 0; qOn < 30; qOn += 0.25) {
      for (const len of [0.25, 0.5, 1, 2, 4]) {
        const with_ = map.T(qOn + len) - map.T(qOn);
        const without = plain.T(qOn + len) - plain.T(qOn);
        expect(with_).toBeGreaterThanOrEqual(without - 1e-12);
      }
    }
    // A chord held across the breath sustains exactly the extra time longer.
    expect(map.T(14) - map.T(8) - (plain.T(14) - plain.T(8))).toBeCloseTo(0.45, 6);
  });

  it('adds exactly its own time inside a broadening and next to another breath', () => {
    const shape: TimingGesture = { kind: 'shape', id: 's', start: 8, peak: 14, hold: 14, end: 18, ratio: 0.85 };
    const shaped = flat(66, 40, [shape]);
    const map = flat(66, 40, [shape, breath(14, 0.35), breath(15, 0.2)]);
    expect(map.duration - shaped.duration).toBeCloseTo(0.55, 6);
  });

  it('clamps when the note is too short for the requested time', () => {
    const map = flat(160, 16, [breath(8, 2, 7.5)]);
    expect(map.breaths[0].clamped).toBe(true);
    expect(map.breaths[0].minRatio).toBeCloseTo(MIN_BREATH_RATIO, 9);
    expect(map.breaths[0].addedSec).toBeLessThan(2);
  });

  it('works across a written tempo change inside the note', () => {
    const tempos = [{ q: 0, bpm: 60 }, { q: 7.5, bpm: 90 }];
    const plain = buildTimeMap({ tempos, endQ: 16 });
    const map = buildTimeMap({ tempos, endQ: 16, gestures: [breath(8, 0.25, 7)] });
    expect(map.duration - plain.duration).toBeCloseTo(0.25, 6);
  });
});
