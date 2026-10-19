// The examples in examples/ must keep working: each performance file loads, is
// made for the example score, every gesture lands in the score, and every voice
// of a voicing has notes to play.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Window } from 'happy-dom';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { breathWindow, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { shapeDynamics } from '../src/perf/dynamics';
import { buildTimeMap } from '../src/perf/timeline';
import type { DynamicsDoc } from '../src/perf/types';
import { renderLoaded, VEROVIO_OPTIONS, type RenderedScore } from '../src/score/verovio';
import { parseDoc } from '../src/storage/persist';

const DIR = 'examples/apollo';
const SCORE = `${DIR}/apollo-learning.mxl`;
let score: RenderedScore;

beforeAll(async () => {
  globalThis.DOMParser = new Window().DOMParser as unknown as typeof DOMParser;
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(VEROVIO_OPTIONS);
  const bytes = fs.readFileSync(SCORE);
  expect(tk.loadZipDataBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBeTruthy();
  score = renderLoaded(tk);
}, 60000);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const sha256 = createHash('sha256').update(fs.readFileSync(SCORE)).digest('hex');
const resolve = (a: Parameters<typeof resolveAnchor>[1]) => resolveAnchor(score.index, a);
const voicesPlay = (dynamics: DynamicsDoc) => {
  const shaped = shapeDynamics({ events: score.events, marks: score.dynamics, hairpins: score.hairpins, doc: dynamics, resolve, barStarts: score.index.played.map((m) => m.q0) });
  const used = new Set(shaped.parts.flatMap((p) => p.notes.map((n) => n.voice)));
  for (const v of dynamics.voices) expect(used, `voice ${v.id} has no notes`).toContain(v.id);
};

describe('examples', () => {
  it('has performance files', () => expect(files.length).toBeGreaterThan(0));

  for (const f of files) {
    it(f, () => {
      const raw = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
      if (!raw.version) {
        // A bare voicing, for Import voicing.
        voicesPlay(raw.dynamics);
        return;
      }
      const doc = parseDoc(raw);
      expect(doc.score?.sha256).toBe(sha256);
      for (const g of doc.gestures) {
        for (const a of g.type === 'breath' ? [g.at] : [g.from, g.to]) expect(resolve(a).length, `${g.id} is outside the score`).toBeGreaterThan(0);
      }
      const map = buildTimeMap({
        tempos: score.events.tempos,
        endQ: score.index.endQ,
        tempoFactor: doc.tempoFactor,
        gestures: compileGestures(doc.gestures, resolve, (q, staff) => breathWindow(score.staffSpans, q, staff)),
      });
      expect(map.duration).toBeGreaterThan(300);
      expect(map.duration).toBeLessThan(600);
      if (doc.dynamics) voicesPlay(doc.dynamics);
    });
  }
});
