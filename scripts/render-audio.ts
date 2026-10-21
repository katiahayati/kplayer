// Renders a performance to audio, offline, the way kplayer plays it: the
// performance file's timing and dynamics, the same SoundFont synth (SpessaSynth)
// and the same piano, and with --hall the same concert hall. Useful for listening
// outside the browser and for measuring the result: with --only, just some voices
// play, so their loudness can be compared (tools/dynamics_arc.py, with the --timing
// file written here).
//
// Usage: npx tsx scripts/render-audio.ts score.mxl performance.kplayer.json out.wav
//          [--voicing file.json]   take the dynamics from this file instead (a performance file or a bare voicing)
//          [--only id,id,…]        play only the notes in these voices ("-" for notes in none)
//          [--parts 1,…]           play only these parts (default: all)
//          [--flat]                no dynamics: every note at Verovio's one velocity
//          [--hall [level]]        in the app's concert hall (1 = its usual amount); leave it out to measure loudness
//          [--timing out.json]     write where each beat falls in the audio, for dynamics_arc.py
//          [--rate 44100]

import fs from 'node:fs';
import path from 'node:path';
import { audioToWav } from 'spessasynth_core';
import { breathWindow, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { shapeDynamics } from '../src/perf/dynamics';
import { renderPerformanceMidi } from '../src/perf/render';
import { buildTimeMap } from '../src/perf/timeline';
import type { DynamicsDoc } from '../src/perf/types';
import { parseDoc } from '../src/storage/persist';
import { loadScoreFile } from './lib/load-score';
import { applyHall } from './lib/hall';
import { createRenderer } from './lib/render';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const flat = args.includes('--flat') ? (args.splice(args.indexOf('--flat'), 1), true) : false;
const hallAt = args.indexOf('--hall');
const hall = hallAt < 0 ? 0 : /^[\d.]+$/.test(args[hallAt + 1] ?? '') ? Number(args.splice(hallAt, 2)[1]) : (args.splice(hallAt, 1), 1);
const voicingFile = flag('voicing');
const only = flag('only')?.split(',');
const parts = flag('parts')?.split(',').map(Number);
const timingFile = flag('timing');
const rate = Number(flag('rate') ?? 44100);
const [scoreFile, docFile, outFile] = args;
if (!outFile) throw new Error('Usage: render-audio.ts score.mxl performance.kplayer.json out.wav [options]');

const score = await loadScoreFile(scoreFile);
const doc = parseDoc(fs.readFileSync(docFile, 'utf8'));
let dynamics: DynamicsDoc | undefined = doc.dynamics;
if (voicingFile) {
  const raw = JSON.parse(fs.readFileSync(voicingFile, 'utf8'));
  dynamics = raw.dynamics ?? raw;
}
const resolve = (a: Parameters<typeof resolveAnchor>[1]) => resolveAnchor(score.index, a);
const map = buildTimeMap({
  tempos: score.events.tempos,
  endQ: score.index.endQ,
  tempoFactor: doc.tempoFactor,
  gestures: compileGestures(doc.gestures, resolve, (q, staff) => breathWindow(score.staffSpans, q, staff)),
});
let events = flat
  ? score.events
  : shapeDynamics({ events: score.events, marks: score.dynamics, hairpins: score.hairpins, doc: dynamics, resolve, barStarts: score.index.played.map((m) => m.q0) });
if (only || parts) {
  events = {
    ...events,
    parts: events.parts
      .filter((p) => !parts || parts.includes(p.index))
      .map((p) => ({ ...p, notes: only ? p.notes.filter((n) => only.includes(n.voice ?? '-')) : p.notes })),
  };
}
const midiBytes = renderPerformanceMidi(events, map, { parts: doc.parts });

const pianoOnly = events.parts.every((p) => p.program < 8);
const { left, right } = await createRenderer(rate, { pianoOnly }).render(midiBytes, map.duration + (hall ? 5 : 3));
if (hall) applyHall(left, right, rate, hall);
const total = left.length;
// Not normalised: renders stay on one scale, so their loudness can be compared.
let peak = 0;
for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
fs.writeFileSync(outFile, new Uint8Array(audioToWav([left, right], rate, { normalizeAudio: false })));
if (timingFile) {
  const onsets: [number, number][] = [];
  for (let q = 0; q <= score.index.endQ + 1e-9; q += 1 / 6) onsets.push([+q.toFixed(6), +map.T(q).toFixed(4)]);
  fs.writeFileSync(timingFile, JSON.stringify({ recording: path.basename(outFile), onsets }));
}
console.error(
  `${path.basename(outFile)}: ${map.duration.toFixed(1)} s${only ? `, voices ${only.join(', ')}` : ''}${flat ? ', flat dynamics' : ''}${hall ? `, hall ${hall}` : ''}, ` +
    `peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS${peak > 1 ? ' (clipped)' : ''}`,
);
