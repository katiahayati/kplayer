// End to end on the fixture song (voice + piano, 5 bars, tie, breath mark,
// repeat over bars 3–4, tempo change in bar 5): Verovio → score index →
// gestures → time map → performance MIDI, read back and checked.

import fs from 'node:fs';
import { Midi } from '@tonejs/midi';
import { Window } from 'happy-dom';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { noteBefore, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { renderPerformanceMidi } from '../src/perf/render';
import { buildTimeMap } from '../src/perf/timeline';
import type { Anchor, Gesture } from '../src/perf/types';
import { renderLoaded, VEROVIO_OPTIONS, type RenderedScore } from '../src/score/verovio';

let score: RenderedScore;

beforeAll(async () => {
  globalThis.DOMParser = new Window().DOMParser as unknown as typeof DOMParser;
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(VEROVIO_OPTIONS);
  expect(tk.loadData(fs.readFileSync('fixtures/song.musicxml', 'utf8'))).toBeTruthy();
  score = renderLoaded(tk);
});

const mapFor = (gestures: Gesture[]) =>
  buildTimeMap({
    tempos: score.events.tempos,
    endQ: score.index.endQ,
    gestures: compileGestures(
      gestures,
      (a) => resolveAnchor(score.index, a),
      (q, staff) => noteBefore(score.staffSpans, q, staff),
    ),
  });

const perform = (gestures: Gesture[], loop?: { q0: number; q1: number }) => {
  const midi = new Midi(renderPerformanceMidi(score.events, mapFor(gestures), { loop }));
  return midi.tracks.flatMap((t, track) => t.notes.map((n) => ({ track, midi: n.midi, on: n.time, off: n.time + n.duration })));
};

const breath = (at: Anchor, extraMs = 300, staff = '1'): Gesture => ({ id: `b${at.measureIndex}`, type: 'breath', at, staff, extraMs });

describe('score index', () => {
  it('expands the repeat', () => {
    expect(score.index.measures.map((m) => m.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(score.index.played.map((p) => p.measureIndex)).toEqual([0, 1, 2, 3, 2, 3, 4]);
    expect(score.index.endQ).toBeCloseTo(28, 1);
  });

  it('groups the piano staves into one part', () => {
    expect(score.events.parts.map((p) => [p.name, p.tracks])).toEqual([
      ['Voice', [0]],
      ['Piano', [1, 2]],
    ]);
  });

  it('finds the written breath mark after the D in bar 2', () => {
    expect(score.breathMarks).toEqual([{ at: { measureIndex: 1, offsetQ: 2, label: '2' }, staff: '1' }]);
  });
});

describe('time map against Verovio', () => {
  it('matches every timemap entry within 1 ms when there are no gestures', () => {
    const map = mapFor([]);
    for (const e of score.timemap) expect(Math.abs(map.T(e.qstamp) * 1000 - e.tstamp)).toBeLessThanOrEqual(1);
  });
});

describe('performance MIDI', () => {
  it('a breath holds only the note before it longer, and never shortens a note', () => {
    const plain = perform([]);
    const breathed = perform([breath(score.breathMarks[0].at)]);
    expect(breathed.length).toBe(plain.length);
    const end = (ns: typeof plain) => Math.max(...ns.map((n) => n.off));
    expect(end(breathed) - end(plain)).toBeCloseTo(0.3, 2);
    breathed.forEach((n, i) => expect(n.off - n.on).toBeGreaterThanOrEqual(plain[i].off - plain[i].on - 0.002));

    // The voice's D (q 5–6) starts on time and lasts 300 ms longer; the next note (q 6) comes in 300 ms later.
    const voice = (ns: typeof plain, i: number) => ns.filter((n) => n.track === 0)[i];
    expect(voice(breathed, 3).on).toBeCloseTo(voice(plain, 3).on, 3);
    expect(voice(breathed, 3).off - voice(breathed, 3).on - (voice(plain, 3).off - voice(plain, 3).on)).toBeCloseTo(0.3, 2);
    expect(voice(breathed, 4).on - voice(plain, 4).on).toBeCloseTo(0.3, 2);
    // Every voice note before the D is untouched.
    for (const i of [0, 1, 2]) expect(voice(breathed, i).on).toBeCloseTo(voice(plain, i).on, 3);

    // The piano chord of bar 2 (held across the breath at q = 6) sustains 300 ms longer.
    const chord = (ns: typeof plain) => ns.find((n) => n.track === 1 && n.midi === 65)!;
    expect(chord(breathed).off - chord(breathed).on - (chord(plain).off - chord(plain).on)).toBeCloseTo(0.3, 2);
  });

  it('a breath in a repeated bar applies on both passes', () => {
    const plain = perform([]);
    const breathed = perform([breath({ measureIndex: 3, offsetQ: 4 }, 250)]);
    expect(Math.max(...breathed.map((n) => n.off)) - Math.max(...plain.map((n) => n.off))).toBeCloseTo(0.5, 2);
  });

  it('renders a loop window starting at zero with loop markers', () => {
    const map = mapFor([]);
    const bytes = renderPerformanceMidi(score.events, map, { loop: { q0: 4, q1: 12 } });
    const midi = new Midi(bytes);
    const notes = midi.tracks.flatMap((t) => t.notes);
    expect(Math.min(...notes.map((n) => n.time))).toBe(0);
    expect(midi.header.meta.map((m) => m.text)).toEqual(['loopStart', 'loopEnd']);
    expect(Math.max(...notes.map((n) => n.time + n.duration))).toBeLessThanOrEqual(map.T(12) - map.T(4) + 1e-3);
  });
});
