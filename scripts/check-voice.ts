// How closely does a performance file follow the singer? Plays the file through
// kplayer's timing engine and compares each sung note's time with where the
// singer actually starts it in the recording (tools/align_voice.py).
// Usage: npx tsx scripts/check-voice.ts score.mxl performance.kplayer.json voice.json

import fs from 'node:fs';
import { breathWindow, resolveAnchor } from '../src/perf/anchors';
import { compileGestures } from '../src/perf/compile';
import { buildTimeMap } from '../src/perf/timeline';
import { parseDoc } from '../src/storage/persist';
import { loadScoreFile } from './lib/load-score';

const [scoreFile, docFile, voiceFile] = process.argv.slice(2);
if (!voiceFile) throw new Error('Usage: check-voice.ts score.mxl performance.kplayer.json voice.json');
const score = await loadScoreFile(scoreFile);
const doc = parseDoc(fs.readFileSync(docFile, 'utf8'));
const voice = JSON.parse(fs.readFileSync(voiceFile, 'utf8')) as { notes: { q: number; found: number | null; how: string }[] };

const map = buildTimeMap({
  tempos: score.events.tempos,
  endQ: score.index.endQ,
  tempoFactor: doc.tempoFactor,
  gestures: compileGestures(
    doc.gestures,
    (a) => resolveAnchor(score.index, a),
    (q, staff) => breathWindow(score.staffSpans, q, staff),
  ),
});

const sung = voice.notes.filter((n) => n.found !== null);
// Line the file up with the recording by the median offset over all sung notes
// (lining up at one note would shift everything by that note's error).
const offsets = sung.map((n) => n.found! - map.T(n.q)).sort((a, b) => a - b);
const offset = offsets[offsets.length >> 1];
const rows = sung.map((n) => ({ q: n.q, err: map.T(n.q) + offset - n.found! }));
const abs = rows.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
const pct = (p: number) => abs[Math.floor(p * (abs.length - 1))];
console.log(`${rows.length} sung notes: median ${pct(0.5).toFixed(2)} s off, 90% within ${pct(0.9).toFixed(2)} s, worst ${pct(1).toFixed(2)} s`);

// Where it goes wrong: bars whose sung notes are off by more than 0.3 s on average.
const barOf = (q: number) => score.index.played.findLast((p) => p.q0 <= q + 1e-9)!;
const byBar = new Map<string, number[]>();
for (const r of rows) {
  const label = score.index.measures[barOf(r.q).measureIndex].label;
  byBar.set(label, [...(byBar.get(label) ?? []), r.err]);
}
const bad = [...byBar].filter(([, errs]) => Math.abs(errs.reduce((s, e) => s + e, 0) / errs.length) > 0.3);
console.log(
  bad.length
    ? 'bars more than 0.3 s off (+ = the file is late): ' +
        bad.map(([bar, errs]) => `${bar} (${(errs.reduce((s, e) => s + e, 0) / errs.length).toFixed(2)})`).join(', ')
    : 'no bar is more than 0.3 s off on average',
);
