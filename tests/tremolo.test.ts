// Tremolos: Verovio's MIDI drops fingered (two-note) tremolos, so the score
// loader expands them itself. It already plays single-note tremolos.
// fixtures/tremolo.musicxml: a fingered tremolo C4↔E4 for a half note, then a
// single-note tremolo on G4 for a half note (both 32nds), then a whole-note C5.

import fs from 'node:fs';
import { Window } from 'happy-dom';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { findTremolos } from '../src/score/tremolos';
import { renderLoaded, VEROVIO_OPTIONS, type RenderedScore } from '../src/score/verovio';

let score: RenderedScore;

beforeAll(async () => {
  globalThis.DOMParser = new Window().DOMParser as unknown as typeof DOMParser;
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(VEROVIO_OPTIONS);
  expect(tk.loadData(fs.readFileSync('fixtures/tremolo.musicxml', 'utf8'))).toBeTruthy();
  score = renderLoaded(tk);
});

const notesIn = (q0: number, q1: number) =>
  score.events.parts[0].notes.filter((n) => n.qOn >= q0 - 1e-9 && n.qOn < q1 - 1e-9).map((n) => [n.qOn, n.midi, +(n.qOff - n.qOn).toFixed(3)]);

describe('tremolos', () => {
  it('finds fingered tremolos, chords included, in MEI', () => {
    const mei = `<fTrem xml:id="t1" beams="3"><note xml:id="a" pname="c"/><chord xml:id="c"><note xml:id="b1"/><note xml:id="b2"/></chord></fTrem>
      <bTrem xml:id="t2" form="meas"><note xml:id="d" stem.mod="2slash"/></bTrem><fTrem xml:id="t3" unitdur="16"><note xml:id="e"/><note xml:id="f"/></fTrem>`;
    expect(findTremolos(mei)).toEqual([
      { first: ['a'], second: ['b1', 'b2'], unit: 0.125 },
      { first: ['e'], second: ['f'], unit: 0.25 },
    ]);
  });

  it('plays a fingered tremolo as alternating 32nds', () => {
    const fingered = notesIn(0, 2);
    expect(fingered).toHaveLength(16);
    fingered.forEach(([q, midi, len], i) => {
      expect(q).toBeCloseTo(i * 0.125, 9);
      expect(midi).toBe(i % 2 ? 64 : 60);
      expect(len).toBeCloseTo(0.125, 9);
    });
  });

  it('plays a single-note tremolo as repeated 32nds, once (Verovio already does)', () => {
    const single = notesIn(2, 4);
    expect(single).toHaveLength(16);
    single.forEach(([q, midi], i) => {
      expect(q).toBeCloseTo(2 + i * 0.125, 9);
      expect(midi).toBe(67);
    });
  });

  it('leaves other notes alone', () => {
    expect(notesIn(4, 8)).toEqual([[4, 72, expect.closeTo(4, 1)]]);
  });
});
