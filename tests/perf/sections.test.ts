// Editing a performance after loading it: Slow down / Speed up arrive at a
// tempo relative to the basic tempo, so deleting, changing, switching off,
// moving or adding a section only changes the music up to where the next
// section arrives. The Tempo slider scales everything and leaves the
// percentages alone. Runs the app's path: file → parseDoc → compile → time map.

import { describe, expect, it } from 'vitest';
import { compileGestures } from '../../src/perf/compile';
import { buildTimeMap, type TempoPoint, type TimeMap } from '../../src/perf/timeline';
import type { Anchor, Gesture, PerformanceDoc } from '../../src/perf/types';
import { parseDoc } from '../../src/storage/persist';

// Measures of 4 quarters, no repeats: measure i starts at q = 4i. Breaths act over one quarter either side.
const END_Q = 64;
const resolve = (a: Anchor) => [a.measureIndex * 4 + a.offsetQ];
const breathWindow = (q: number) => ({ start: q - 1, end: q + 1 });
const m = (measureIndex: number, offsetQ = 0): Anchor => ({ measureIndex, offsetQ });

// As a version 2 file would arrive from Import or the fitting script.
const file = JSON.stringify({
  version: 2,
  tempoFactor: 1,
  parts: {},
  gestures: [
    { id: 'r1', type: 'ramp', from: m(1), to: m(2), target: 0.8 }, // q 4–8
    { id: 'r2', type: 'ramp', from: m(4), to: m(5), target: 1.1 }, // q 16–20
    { id: 's', type: 'shape', gesture: 'broaden', from: m(6), to: m(7), amount: 0.1, peak: 0.5, releaseQ: 0 }, // q 24–28
    { id: 'b', type: 'breath', at: m(7), extraMs: 300 }, // q 28, acting 27–29
    { id: 'r3', type: 'ramp', from: m(8), to: m(9), target: 0.9 }, // q 32–36
    { id: 'a', type: 'aTempo', from: m(11), to: m(12) }, // q 44–48
    { id: 'r4', type: 'ramp', from: m(13), to: m(14), target: 1.2 }, // q 52–56
  ],
});
const loaded = parseDoc(file);

const play = (doc: PerformanceDoc, tempos: TempoPoint[] = [{ q: 0, bpm: 100 }]): TimeMap =>
  buildTimeMap({ tempos, endQ: END_Q, tempoFactor: doc.tempoFactor, gestures: compileGestures(doc.gestures, resolve, breathWindow) });

const without = (...ids: string[]): PerformanceDoc => ({ ...loaded, gestures: loaded.gestures.filter((g) => !ids.includes(g.id)) });
const changed = (id: string, patch: Partial<Gesture>): PerformanceDoc => ({
  ...loaded,
  gestures: loaded.gestures.map((g) => (g.id === id ? ({ ...g, ...patch } as Gesture) : g)),
});
const added = (g: Gesture): PerformanceDoc => ({ ...loaded, gestures: [...loaded.gestures, g] });

/** The two play every note from q on identically: same tempo throughout and the same time from q to the end. */
function samePlayingFrom(a: TimeMap, b: TimeMap, q: number) {
  for (let x = q; x <= END_Q; x += 0.25) expect(a.bpmAt(x)).toBeCloseTo(b.bpmAt(x), 9);
  expect(a.duration - a.T(q)).toBeCloseTo(b.duration - b.T(q), 9);
}

/** The two play identically up to q. */
function samePlayingUntil(a: TimeMap, b: TimeMap, q: number) {
  for (let x = 0; x <= q; x += 0.25) {
    expect(a.bpmAt(x)).toBeCloseTo(b.bpmAt(x), 9);
    expect(a.T(x)).toBeCloseTo(b.T(x), 9);
  }
}

const original = play(loaded);

describe('a loaded performance', () => {
  it('arrives where each section says, as a percentage of the basic tempo', () => {
    expect(loaded.version).toBe(2);
    expect([0, 8, 20, 36, 48, 56, 63].map((q) => original.bpmAt(q))).toEqual(
      [100, 80, 110, 90, 100, 120, 120].map((bpm) => expect.closeTo(bpm, 9)),
    );
    // The broaden and the breath dip and come back to the section's tempo.
    expect(original.bpmAt(26)).toBeLessThan(110);
    expect(original.bpmAt(29)).toBeCloseTo(110, 9);
    expect(original.breaths[0].addedSec).toBeCloseTo(0.3, 6);
  });

  it("doesn't care what order the file lists the gestures in", () => {
    samePlayingFrom(play({ ...loaded, gestures: [...loaded.gestures].reverse() }), original, 0);
  });
});

describe('editing it', () => {
  it('deleting a Slow down changes only the music up to where the next section arrives', () => {
    const map = play(without('r1'));
    expect(map.bpmAt(10)).toBeCloseTo(100, 9); // was 80
    expect(map.bpmAt(20)).toBeCloseTo(110, 9);
    samePlayingFrom(map, original, 20);
  });

  it('deleting a Speed up holds the tempo before it until the next section', () => {
    const map = play(without('r2'));
    expect(map.bpmAt(22)).toBeCloseTo(80, 9);
    expect(map.bpmAt(29)).toBeCloseTo(80, 9); // the broaden and breath now return to 80
    expect(map.bpmAt(36)).toBeCloseTo(90, 9);
    samePlayingFrom(map, original, 36);
    // The breath still adds exactly its own time at the slower tempo.
    expect(map.breaths[0].addedSec).toBeCloseTo(0.3, 6);
  });

  it('changing a target, switching a section off or moving it leaves later sections alone', () => {
    const edits: PerformanceDoc[] = [
      changed('r2', { target: 0.5 }),
      changed('r2', { target: 2.5 }),
      changed('r2', { enabled: false }),
      changed('r2', { from: m(2), to: m(3) }),
      changed('r1', { target: 1.6 }),
    ];
    for (const doc of edits) samePlayingFrom(play(doc), original, 36);
    // Switched off is the same as deleted.
    samePlayingFrom(play(changed('r2', { enabled: false })), play(without('r2')), 0);
  });

  it('adding a section in between leaves the ones after it alone', () => {
    const map = play(added({ id: 'new', type: 'ramp', from: m(2), to: m(3), target: 1.5 }));
    expect(map.bpmAt(14)).toBeCloseTo(150, 9);
    expect(map.bpmAt(20)).toBeCloseTo(110, 9); // r2 now slows down to get there
    samePlayingFrom(map, original, 20);
    samePlayingUntil(map, original, 8);
  });

  it('deleting a broaden or a breath changes nothing outside it', () => {
    for (const ids of [['s'], ['b'], ['s', 'b']]) {
      const map = play(without(...ids));
      samePlayingUntil(map, original, 24);
      samePlayingFrom(map, original, 29);
    }
  });

  it('deleting an a tempo holds the tempo before it until the next section', () => {
    const map = play(without('a'));
    expect(map.bpmAt(50)).toBeCloseTo(90, 9);
    expect(map.bpmAt(56)).toBeCloseTo(120, 9);
    samePlayingFrom(map, original, 56);
    samePlayingUntil(map, original, 44);
  });

  it('a section starting inside another still arrives at its own target, without a jump', () => {
    const map = play(changed('r2', { from: m(1, 2) })); // starts halfway through r1
    expect(map.bpmAt(20)).toBeCloseTo(110, 9);
    samePlayingFrom(map, original, 20);
    for (let q = 0; q < 20; q += 1 / 64) expect(Math.abs(map.bpmAt(q + 1 / 64) - map.bpmAt(q))).toBeLessThan(1);
  });

  it('survives saving and loading again after edits', () => {
    const edited = changed('r3', { target: 0.75 });
    samePlayingFrom(play(parseDoc(JSON.stringify(edited))), play(edited), 0);
  });
});

describe('the Tempo slider', () => {
  const at = (factor: number, doc: PerformanceDoc = loaded) => ({ ...doc, tempoFactor: factor });

  it('scales every tempo and keeps the percentages and the breath times', () => {
    const slow = play(at(0.8));
    // Except inside the breath: it adds a fixed 300 ms, which at a slower tempo takes a shallower dip.
    for (let q = 0; q <= END_Q; q += 0.25) if (q <= 27 || q >= 29) expect(slow.bpmAt(q)).toBeCloseTo(0.8 * original.bpmAt(q), 9);
    expect(slow.breaths[0].minRatio).toBeGreaterThan(original.breaths[0].minRatio);
    expect(slow.bpmAt(8)).toBeCloseTo(64, 9); // Slow down to 80% of ♩ = 80
    expect(slow.breaths[0].addedSec).toBeCloseTo(0.3, 6);
    // Everything but the breath takes 1/0.8 as long.
    expect(slow.duration - 0.3).toBeCloseTo((original.duration - 0.3) / 0.8, 6);
  });

  it('still leaves later sections alone when you delete one', () => {
    for (const factor of [0.6, 1.3]) {
      const map = play(at(factor, without('r1')));
      expect(map.bpmAt(20)).toBeCloseTo(110 * factor, 9);
      samePlayingFrom(map, play(at(factor)), 20);
    }
  });

  it('percentages follow the written tempo marks', () => {
    // A written tempo change to ♩ = 60 at q 40, while the music is at 90%.
    const tempos = [{ q: 0, bpm: 100 }, { q: 40, bpm: 60 }];
    for (const factor of [1, 0.8]) {
      const map = play(at(factor), tempos);
      expect(map.bpmAt(38)).toBeCloseTo(90 * factor, 9);
      expect(map.bpmAt(42)).toBeCloseTo(54 * factor, 9);
      expect(map.bpmAt(48)).toBeCloseTo(60 * factor, 9); // a tempo: the written tempo
      expect(map.bpmAt(56)).toBeCloseTo(72 * factor, 9);
    }
  });
});
