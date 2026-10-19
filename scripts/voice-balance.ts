// How the voices of a voicing balance, bar by bar: renders each voice alone
// through kplayer's synth and piano, measures its loudness, and prints each
// voice against the loudest of the others. A melody should stand a few
// decibels above its accompaniment to come through.
//
// Usage: npx tsx scripts/voice-balance.ts score.mxl performance.kplayer.json [--voicing file.json] [--part 1]
//          [--lead melody] [--bars 1-20]
//
// --lead names the voice to compare with the rest (default: the first voice marked "ahead").

import fs from 'node:fs';
import { breathWindow, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { shapeDynamics } from '../src/perf/dynamics';
import { renderPerformanceMidi } from '../src/perf/render';
import { buildTimeMap } from '../src/perf/timeline';
import type { DynamicsDoc } from '../src/perf/types';
import { parseDoc } from '../src/storage/persist';
import { loadScoreFile } from './lib/load-score';
import { beatLoudness, momentaryPower } from './lib/loudness';
import { createRenderer } from './lib/render';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const voicingFile = opt('voicing');
const partIndex = Number(opt('part') ?? 1);
const leadOpt = opt('lead');
const [firstBar, lastBar] = (opt('bars') ?? '1-9999').split('-').map(Number);
const [scoreFile, docFile] = args;
if (!docFile) throw new Error('Usage: voice-balance.ts score.mxl performance.kplayer.json [--voicing file.json] [--part 1] [--lead id] [--bars 1-20]');

const score = await loadScoreFile(scoreFile);
const doc = parseDoc(fs.readFileSync(docFile, 'utf8'));
let dynamics: DynamicsDoc | undefined = doc.dynamics;
if (voicingFile) {
  const raw = JSON.parse(fs.readFileSync(voicingFile, 'utf8'));
  const v: DynamicsDoc = raw.dynamics ?? raw;
  // Take the voices (and lead) from the voicing file, keeping the performance's own dynamic shape.
  dynamics = { ...(dynamics ?? {}), voices: v.voices, leadMs: v.leadMs ?? dynamics?.leadMs };
}
if (!dynamics?.voices.length) throw new Error('No voices to balance');
const lead = leadOpt ?? dynamics.voices.find((v) => v.lead)?.id ?? dynamics.voices.at(-1)!.id;

const resolve = (a: Parameters<typeof resolveAnchor>[1]) => resolveAnchor(score.index, a);
const map = buildTimeMap({
  tempos: score.events.tempos,
  endQ: score.index.endQ,
  tempoFactor: doc.tempoFactor,
  gestures: compileGestures(doc.gestures, resolve, (q, staff) => breathWindow(score.staffSpans, q, staff)),
});
const shaped = shapeDynamics({ events: score.events, marks: score.dynamics, hairpins: score.hairpins, doc: dynamics, resolve, barStarts: score.index.played.map((m) => m.q0) });
const part = shaped.parts.find((p) => p.index === partIndex)!;
const renderer = createRenderer(32000, { pianoOnly: part.program < 8 });

const ids = [...dynamics.voices.map((v) => v.id), '-'];
const loudness = new Map<string, Map<number, number>>();
for (const id of ids) {
  const notes = part.notes.filter((n) => (n.voice ?? '-') === id);
  if (!notes.length) continue;
  const midi = renderPerformanceMidi({ ...shaped, parts: [{ ...part, notes }] }, map, { parts: doc.parts });
  const { left, right } = await renderer.render(midi, map.duration + 2);
  loudness.set(id, new Map(beatLoudness(momentaryPower(left, right, renderer.rate), (q) => map.T(q), score.index.endQ).map((b) => [b.q, b.lufs])));
}

const energyMean = (xs: number[]) => (xs.length ? 10 * Math.log10(xs.reduce((s, x) => s + 10 ** (x / 10), 0) / xs.length) : -Infinity);
const name = (id: string) => (id === '-' ? 'no voice' : id);
console.log(`bar  ${lead} vs loudest other   (each voice, LUFS)`);
const margins: number[] = [];
for (const m of score.index.played) {
  const label = score.index.measures[m.measureIndex].label;
  if (Number(label) < firstBar || Number(label) > lastBar) continue;
  const level = new Map<string, number>();
  for (const [id, by] of loudness) {
    // Only beats where this voice strikes: its own level, not its decay.
    const beats = [...by.keys()].filter((q) => q >= m.q0 && q < m.q1 && part.notes.some((n) => (n.voice ?? '-') === id && n.qOn >= q - 1e-6 && n.qOn < q + 1 - 1e-6));
    if (beats.length) level.set(id, energyMean(beats.map((q) => by.get(q)!)));
  }
  const others = [...level].filter(([id]) => id !== lead).sort((a, b) => b[1] - a[1]);
  const margin = level.has(lead) && others.length ? level.get(lead)! - others[0][1] : undefined;
  if (margin !== undefined) margins.push(margin);
  const cols = [...level].map(([id, l]) => `${name(id)} ${l.toFixed(0)}`).join('  ');
  console.log(`${label.padStart(3)}  ${margin === undefined ? '      ' : `${margin >= 0 ? '+' : ''}${margin.toFixed(1)} dB`.padEnd(8)}${others[0] && margin !== undefined ? ` over ${name(others[0][0])}`.padEnd(14) : ''.padEnd(14)} ${cols}`);
}
if (margins.length) {
  const sorted = [...margins].sort((a, b) => a - b);
  console.log(`${lead} on top in ${margins.filter((x) => x > 0).length} of ${margins.length} bars; median margin ${sorted[sorted.length >> 1].toFixed(1)} dB`);
}
