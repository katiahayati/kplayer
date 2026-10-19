// Dynamics: reading the score's dynamics and each note's staff and voice from
// Verovio's MEI, then shaping velocities, lead and pedal from them.
// fixtures/dynamics.musicxml: piano; right hand voice 1 a held melody, voice 2
// repeated quarters (bar 1); p, a crescendo through bar 2 to f in bar 3, then a
// 3/2 bar with pp on its second beat.

import fs from 'node:fs';
import { Window } from 'happy-dom';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveAnchor } from '../src/perf/anchors';
import { MARKING_VELOCITY, shapeDynamics, velocityGain, type DynamicsInput } from '../src/perf/dynamics';
import { renderPerformanceMidi, type ScoreEvents } from '../src/perf/render';
import { buildTimeMap } from '../src/perf/timeline';
import type { Anchor, DynamicsDoc } from '../src/perf/types';
import { readMei } from '../src/score/mei';
import { renderLoaded, VEROVIO_OPTIONS, type RenderedScore } from '../src/score/verovio';
import tonejs from '@tonejs/midi';

let score: RenderedScore;
let tk: VerovioToolkit;

beforeAll(async () => {
  globalThis.DOMParser = new Window().DOMParser as unknown as typeof DOMParser;
  tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(VEROVIO_OPTIONS);
  expect(tk.loadData(fs.readFileSync('fixtures/dynamics.musicxml', 'utf8'))).toBeTruthy();
  score = renderLoaded(tk);
});

const bar = (n: number, offsetQ = 0): Anchor => ({ measureIndex: n - 1, offsetQ });
const shape = (doc?: DynamicsDoc): ScoreEvents =>
  shapeDynamics({
    events: score.events,
    marks: score.dynamics,
    hairpins: score.hairpins,
    doc,
    resolve: (a) => resolveAnchor(score.index, a),
    barStarts: score.index.played.map((m) => m.q0),
  } satisfies DynamicsInput);
const velocities = (events: ScoreEvents, filter: (n: ScoreEvents['parts'][number]['notes'][number]) => boolean) =>
  events.parts[0].notes.filter(filter).map((n) => Math.round(n.velocity * 127));

describe('reading the score', () => {
  it("knows each note's staff and voice", () => {
    const notes = score.events.parts[0].notes.map((n) => [n.qOn, n.midi, n.staff, n.layer]);
    expect(notes.slice(0, 6)).toEqual([
      [0, 48, 2, 5],
      [0, 64, 1, 2],
      [0, 72, 1, 1],
      [1, 64, 1, 2],
      [2, 66, 1, 2],
      [3, 64, 1, 2],
    ]);
    expect(score.events.parts[0].notes.every((n) => n.id)).toBe(true);
  });

  it('places the dynamics and hairpins, beats of a 3/2 bar included', () => {
    expect(score.dynamics).toEqual([
      { q: 0, staff: 1, text: 'p', velocity: 49 },
      { q: 8, staff: 1, text: 'f', velocity: 88 },
      { q: 14, staff: 1, text: 'pp', velocity: 32 },
    ]);
    expect(score.hairpins).toEqual([{ q0: 4, q1: 8, staff: 1, form: 'cres' }]);
  });

  it("reads the same pitches Verovio plays", () => {
    for (const n of readMei(tk.getMEI()).notes) expect(n.pitch).toBe(tk.getMIDIValuesForElement(n.id).pitch);
  });
});

describe('written dynamics', () => {
  it('play at their level, through the crescendo, for every staff of the part', () => {
    const shaped = shape();
    const at = (q: number) => velocities(shaped, (n) => n.qOn === q);
    expect(at(0)).toEqual([49, 49, 49]);
    expect(at(8)).toEqual([88, 88]);
    expect(at(12)).toEqual([88, 88]); // the 3/2 bar starts f
    expect(at(14)).toEqual([32]);
    // Halfway through the crescendo isn't reached by a note here, but its start is p.
    expect(at(4)).toEqual([49, 49]);
  });

  it('a crescendo added by the performance rises evenly to where it is going', () => {
    const shaped = shape({ voices: [], hairpins: [{ id: 'h', from: bar(1, 1), to: bar(1, 3), form: 'cres', level: 'mf' }] });
    // Even in decibels: the geometric mean of p and mf halfway.
    expect(velocities(shaped, (n) => n.layer === 2)).toEqual([49, 49, Math.round(Math.sqrt(49 * 72)), 72]);
  });

  it("a performance with its own shape can replace the score's dynamics", () => {
    const own = shape({ voices: [], written: false, marks: [{ id: 'm', at: bar(1), level: 60 }], hairpins: [{ id: 'h', from: bar(3), to: bar(4), form: 'dim', level: 40 }] });
    expect(velocities(own, (n) => n.layer === 1)).toEqual([60, 60, 60, 40, 40, 40]);
    // Without dynamics of its own, the score's still play.
    expect(velocities(shape({ voices: [], written: false }), (n) => n.layer === 1)).toEqual([49, 49, 88, 88, 32, 32]);
  });

  it('dynamics added by the performance apply from where they are', () => {
    const shaped = shape({ voices: [], marks: [{ id: 'm', at: bar(1, 2), level: 'ff' }] });
    expect(velocities(shaped, (n) => n.layer === 2)).toEqual([49, 49, 101, 101]);
  });
});

describe('voicing', () => {
  it('raises a melody and lowers an accompaniment by decibels, at any dynamic', () => {
    const shaped = shape({
      voices: [
        { id: 'acc', name: 'Repeated chords', select: { staff: [1], layer: [2] }, gainDb: -12 },
        { id: 'mel', name: 'Melody', select: { staff: [1], layer: [1] }, gainDb: 4 },
      ],
    });
    expect(velocities(shaped, (n) => n.layer === 2)).toEqual([Math.round(49 * velocityGain(-12))].concat(Array(3).fill(Math.round(49 * velocityGain(-12)))));
    expect(velocities(shaped, (n) => n.layer === 1)).toEqual([49, 49, 88, 88, 32, 32].map((v) => Math.round(v * velocityGain(4))));
    // The left hand is untouched.
    expect(velocities(shaped, (n) => n.staff === 2)).toEqual([49, 49, 88, 88]);
  });

  it('picks the top or bottom note, only within its bars, and the later voice wins', () => {
    const shaped = shape({
      voices: [
        { id: 'all', name: 'Everything', select: {}, gainDb: -6 },
        { id: 'top', name: 'Top', from: bar(1), to: bar(2), select: { top: true }, gainDb: 6 },
      ],
    });
    const at0 = shaped.parts[0].notes.filter((n) => n.qOn === 0).map((n) => [n.midi, Math.round(n.velocity * 127)]);
    expect(at0).toEqual([
      [48, Math.round(49 * velocityGain(-6))],
      [64, Math.round(49 * velocityGain(-6))],
      [72, Math.round(49 * velocityGain(6))],
    ]);
    // Bar 2's top note is outside the Top voice.
    expect(velocities(shaped, (n) => n.qOn === 4 && n.midi === 74)).toEqual([Math.round(49 * velocityGain(-6))]);
  });

  it('varies repeated notes a little, the same way every time', () => {
    const doc: DynamicsDoc = { voices: [{ id: 'v', name: 'Pulse', select: { layer: [2] }, gainDb: 0, varyDb: 3 }] };
    const a = velocities(shape(doc), (n) => n.layer === 2);
    expect(a).toEqual(velocities(shape(doc), (n) => n.layer === 2));
    expect(new Set(a).size).toBeGreaterThan(1);
    for (const v of a) expect(Math.abs(40 * Math.log10(v / 49))).toBeLessThanOrEqual(3 + 0.4);
  });

  it('a leading voice sounds ahead of the others', () => {
    const shaped = shape({ voices: [{ id: 'mel', name: 'Melody', select: { layer: [1] }, gainDb: 0, lead: true }], leadMs: 25 });
    const map = buildTimeMap({ tempos: [{ q: 0, bpm: 60 }], endQ: score.index.endQ });
    const midi = new tonejs.Midi(renderPerformanceMidi(shaped, map));
    const notes = midi.tracks.flatMap((t) => t.notes);
    const onset = (pitch: number, q: number) => notes.find((n) => n.midi === pitch && Math.abs(n.time - q) < 0.1)!.time;
    expect(onset(72, 0)).toBeCloseTo(0, 3); // can't go before the start
    expect(onset(74, 4)).toBeCloseTo(4 - 0.025, 3);
    expect(onset(59, 4)).toBeCloseTo(4, 3);
  });
});

describe('pedal', () => {
  const pedal = (doc: DynamicsDoc) => shape(doc).parts[0].controls.filter((c) => c.number === 64).map((c) => [+c.q.toFixed(2), c.value]);

  it('changes with the harmony: a new bass, or a note the beat before did not have', () => {
    // C major over C (with passing notes F# and E on beats 3 and 4), then G over B, then C over C, a bar each.
    expect(pedal({ voices: [], pedal: [{ id: 'p', from: bar(1), to: bar(4), mode: 'harmony' }] })).toEqual([
      [0.08, 1],
      [2, 0],
      [2.08, 1],
      [3, 0],
      [3.08, 1],
      [4, 0],
      [4.08, 1],
      [8, 0],
      [8.08, 1],
      [12, 0],
    ]);
  });

  it('changes every bar, or stays off', () => {
    expect(pedal({ voices: [], pedal: [{ id: 'p', from: bar(1), to: bar(3), mode: 'bar' }] })).toEqual([
      [0.08, 1],
      [4, 0],
      [4.08, 1],
      [8, 0],
    ]);
    expect(pedal({ voices: [], pedal: [{ id: 'p', from: bar(2), to: bar(3), mode: 'off' }] })).toEqual([[4, 0]]);
  });
});

it('every written marking has a velocity, softest to loudest', () => {
  const order = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff'].map((m) => MARKING_VELOCITY[m]);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});
