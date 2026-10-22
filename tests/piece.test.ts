// Piece files (.kplayer): the score and its performance in one file.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyDoc, type PerformanceDoc } from '../src/perf/types';
import { looksLikePiece, readPiece, writePiece } from '../src/storage/piece';

const score = { name: 'song.musicxml', sha256: 'abc123', bytes: new Uint8Array(fs.readFileSync('fixtures/song.musicxml')) };
const performance: PerformanceDoc = {
  ...emptyDoc(),
  tempoFactor: 1.1,
  gestures: [{ id: 'b1', type: 'breath', at: { measureIndex: 2, offsetQ: 3 }, extraMs: 300 }],
  dynamics: { voices: [{ id: 'rh', name: 'Right hand', select: { part: 1, staff: [1] }, gainDb: -6 }] },
};

describe('piece files', () => {
  it('give back the score file and the performance', () => {
    const text = writePiece({ title: 'Song', score, performance });
    const back = readPiece(text);
    expect(back.title).toBe('Song');
    expect(back.score.name).toBe('song.musicxml');
    expect(back.score.sha256).toBe('abc123');
    expect(back.score.bytes).toEqual(score.bytes);
    expect(back.performance).toEqual({ ...performance, score: { name: 'song.musicxml', sha256: 'abc123' } });
  });

  it('carry binary scores (.mxl) intact', () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7919) % 256);
    expect(readPiece(writePiece({ score: { ...score, bytes }, performance })).score.bytes).toEqual(bytes);
  });

  it('include the demo, whose score is the one its performance was made for', () => {
    const bytes = fs.readFileSync('public/demo/apollo-learning.kplayer');
    expect(looksLikePiece(bytes)).toBe(true);
    const demo = readPiece(bytes.toString('utf8'));
    expect(createHash('sha256').update(demo.score.bytes).digest('hex')).toBe(demo.score.sha256);
    expect(demo.performance.score?.sha256).toBe(demo.score.sha256);
    expect(demo.performance.gestures.length).toBeGreaterThan(0);
    expect(demo.performance.dynamics?.voices.length).toBeGreaterThan(0);
  });

  it('are told apart from scores and from performance files', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(looksLikePiece(enc(writePiece({ score, performance })))).toBe(true);
    expect(looksLikePiece(score.bytes)).toBe(false);
    expect(looksLikePiece(Uint8Array.of(0x50, 0x4b, 3, 4))).toBe(false);
    expect(looksLikePiece(enc(JSON.stringify(performance)))).toBe(false);
    expect(() => readPiece(JSON.stringify(performance))).toThrow('not a kplayer piece');
  });

  it('bring older performances up to date as they open', () => {
    const old = JSON.parse(writePiece({ score, performance }));
    old.performance = { version: 1, tempoFactor: 1, parts: {}, gestures: [{ id: 'r', type: 'ramp', dir: 'slower', amount: 0.2, from: { measureIndex: 0, offsetQ: 0 }, to: { measureIndex: 1, offsetQ: 0 } }] };
    const g = readPiece(JSON.stringify(old)).performance.gestures[0];
    expect(g).toMatchObject({ type: 'ramp', target: 0.8 });
  });
});
