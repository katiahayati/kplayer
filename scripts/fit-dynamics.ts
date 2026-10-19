// Learns a performance's dynamic shape from a recording: how loud the music is
// from moment to moment, as the conductor shapes it. Renders the piano through
// kplayer's synth, measures its loudness beat by beat, and adjusts a level every
// `--every` quarter notes until the rendered loudness follows the recording's
// (relative to each one's median), keeping the voicing's balance on top.
//
// Usage: npx tsx scripts/fit-dynamics.ts score.mxl performance.kplayer.json arc.json voicing.json out.kplayer.json
//          [--part 1] [--every 2] [--range 1] [--smooth 2] [--iterations 4] [--source "Thielemann"]
//
// arc.json is tools/dynamics_arc.py's measurement of the recording (the accompaniment's stem for a song).
// The output is the performance file with these dynamics; Import voicing in the app takes just them.

import fs from 'node:fs';
import { anchorAtQ, breathWindow, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { partLevels, shapeDynamics, type DynamicsInput } from '../src/perf/dynamics';
import { renderPerformanceMidi } from '../src/perf/render';
import { buildTimeMap } from '../src/perf/timeline';
import type { DynamicsDoc, HairpinGesture } from '../src/perf/types';
import { parseDoc } from '../src/storage/persist';
import { loadScoreFile } from './lib/load-score';
import { beatLoudness, momentaryPower } from './lib/loudness';
import { createRenderer } from './lib/render';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args.splice(i, 2)[1];
};
const partIndex = Number(opt('part', '1'));
const every = Number(opt('every', '2'));
const range = Number(opt('range', '1'));
const smooth = Number(opt('smooth', '2'));
const iterations = Number(opt('iterations', '4'));
const source = opt('source', '');
const [scoreFile, docFile, arcFile, voicingFile, outFile] = args;
/** Velocities a learned level stays within: audible, and short of the top. */
const MIN_LEVEL = 10;
const MAX_LEVEL = 120;
if (!outFile) throw new Error('Usage: fit-dynamics.ts score.mxl performance.kplayer.json arc.json voicing.json out.kplayer.json [options]');

const score = await loadScoreFile(scoreFile);
const doc = parseDoc(fs.readFileSync(docFile, 'utf8'));
const voicingRaw = JSON.parse(fs.readFileSync(voicingFile, 'utf8'));
const voicing: DynamicsDoc = voicingRaw.dynamics ?? voicingRaw;
const arc = (JSON.parse(fs.readFileSync(arcFile, 'utf8')).beats as { q: number; lufs: number }[]).filter((b) => b.lufs > -70);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const resolve = (a: Parameters<typeof resolveAnchor>[1]) => resolveAnchor(score.index, a);
const map = buildTimeMap({
  tempos: score.events.tempos,
  endQ: score.index.endQ,
  tempoFactor: doc.tempoFactor,
  gestures: compileGestures(doc.gestures, resolve, (q, staff) => breathWindow(score.staffSpans, q, staff)),
});
const part = score.events.parts.find((p) => p.index === partIndex);
if (!part) throw new Error(`No part ${partIndex}`);
const input = (dynamics: DynamicsDoc): DynamicsInput => ({
  events: { ...score.events, parts: [part] },
  marks: score.dynamics,
  hairpins: score.hairpins,
  doc: dynamics,
  resolve,
  barStarts: score.index.played.map((m) => m.q0),
});
const renderer = createRenderer(32000);
const measure = async (dynamics: DynamicsDoc) => {
  const midi = renderPerformanceMidi(shapeDynamics(input(dynamics)), map, { parts: doc.parts });
  const { left, right } = await renderer.render(midi, map.duration + 2);
  return new Map(beatLoudness(momentaryPower(left, right, renderer.rate), (q) => map.T(q), score.index.endQ).map((b) => [b.q, b.lufs]));
};
const energyMean = (xs: number[]) => 10 * Math.log10(xs.reduce((s, x) => s + 10 ** (x / 10), 0) / xs.length);

// Beats where the part strikes notes: a piano can't swell a held note, so beats it only holds through
// can't be matched and don't count. And the recording's loudness there, smoothed, leaving out its silences
// (before the music, after the last chord).
const strikes = (q: number) => part.notes.some((n) => n.qOn >= q - 1e-6 && n.qOn < q + 1 - 1e-6);
const recMedianAll = median(arc.map((b) => b.lufs));
const recBy = new Map(arc.filter((b) => b.lufs > recMedianAll - 25).map((b) => [b.q, b.lufs]));
const beats = [...recBy.keys()].filter((q) => q <= score.index.endQ - 0.5 && strikes(q));
const recSmooth = new Map(
  beats.map((q) => [q, energyMean(beats.filter((x) => Math.abs(x - q) <= smooth / 2).map((x) => recBy.get(x)!))]),
);

// The written version is the reference: the learned shape is centred on its typical loudness.
const written = await measure({ ...voicing, written: true });
const writtenMedian = median(beats.filter((q) => written.has(q)).map((q) => written.get(q)!));
const recMedian = median(beats.map((q) => recSmooth.get(q)!));
const target = new Map(beats.map((q) => [q, writtenMedian + range * (recSmooth.get(q)! - recMedian)]));

// Level points, starting from the written levels.
const writtenLevel = partLevels(input({ ...voicing, written: true })).get(partIndex)!;
const points: { q: number; level: number }[] = [];
for (let q = 0; q < score.index.endQ - 1e-6; q += every) points.push({ q, level: writtenLevel(q) });

const shapeDoc = (): DynamicsDoc => {
  const at = (q: number) => anchorAtQ(score.index, q)!;
  const hairpins: HairpinGesture[] = points.slice(1).map((p, j) => ({
    id: `d${j + 1}`,
    from: at(points[j].q),
    to: at(p.q),
    form: p.level >= points[j].level ? 'cres' : 'dim',
    level: Math.round(p.level * 10) / 10,
    part: partIndex,
  }));
  return {
    ...voicing,
    written: false,
    marks: [{ id: 'd0', at: at(points[0].q), level: Math.round(points[0].level * 10) / 10, part: partIndex }],
    hairpins,
  };
};

const report = (label: string, measured: Map<number, number>) => {
  const errs = beats.filter((q) => measured.has(q)).map((q) => measured.get(q)! - target.get(q)!);
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  const p90 = errs.map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length * 0.9)];
  console.error(`${label}: ${rms.toFixed(1)} dB rms from the recording's shape, 90% of beats within ${p90.toFixed(1)} dB`);
};
report('written dynamics', written);

for (let k = 1; k <= iterations; k++) {
  const measured = await measure(shapeDoc());
  report(`pass ${k}`, measured);
  for (const p of points) {
    const near = beats.filter((q) => q >= p.q - every / 2 && q < p.q + every / 2 && measured.has(q));
    if (!near.length) continue;
    const err = near.reduce((s, q) => s + (target.get(q)! - measured.get(q)!), 0) / near.length;
    p.level = p.level * 10 ** ((0.8 * err) / 40);
  }
  // A little smoothing (in decibels), so neighbouring points can't zigzag to make up for note density.
  const db = points.map((p) => Math.log10(p.level));
  points.forEach((p, j) => {
    const nb = (db[Math.max(0, j - 1)] + db[Math.min(db.length - 1, j + 1)]) / 2;
    p.level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, 10 ** (0.7 * db[j] + 0.3 * nb)));
  });
}
const final = await measure(shapeDoc());
report('fitted', final);

const out = { ...doc, dynamics: shapeDoc(), dynamicsSource: `Loudness shape fitted to ${source || arcFile} by kplayer's dynamics fitter` };
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const levels = points.map((p) => p.level);
console.error(`${points.length} level points, velocity ${Math.round(Math.min(...levels))}–${Math.round(Math.max(...levels))}; wrote ${outFile}`);
