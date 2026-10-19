// Writes a score's notes (score positions in quarter notes, pitches, parts) as
// JSON, for aligning a recording to it with tools/align_recording.py.
// Usage: npx tsx scripts/export-score.ts score.mxl > score-notes.json

import { loadScoreFile } from './lib/load-score';

const file = process.argv[2];
if (!file) throw new Error('Usage: export-score.ts <score.musicxml|.mxl>');
const score = await loadScoreFile(file);

process.stdout.write(
  JSON.stringify({
    name: score.name,
    sha256: score.sha256,
    endQ: score.index.endQ,
    tempos: score.events.tempos,
    parts: score.events.parts.map((p) => ({ index: p.index, name: p.name, program: p.program })),
    notes: score.events.parts.flatMap((p) => p.notes.map((n) => ({ part: p.index, pitch: n.midi, qOn: n.qOn, qOff: n.qOff }))),
    measures: score.index.played.map((m) => ({ label: score.index.measures[m.measureIndex].label, q0: m.q0, q1: m.q1 })),
  }),
);
