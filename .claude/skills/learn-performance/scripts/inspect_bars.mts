// What a performance file does in some bars, next to the recording: each sung note's time from the
// full-score alignment, from the singer, and in the file (lined up by the median offset), plus the
// gestures touching those bars. Run from the project root:
//   npx tsx .claude/skills/learn-performance/scripts/inspect_bars.mts score.mxl file.kplayer.json analysis/X FIRST LAST
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const { breathWindow, resolveAnchor } = await import(path.join(root, 'src/perf/anchors.ts'));
const { compileGestures } = await import(path.join(root, 'src/perf/compile.ts'));
const { buildTimeMap } = await import(path.join(root, 'src/perf/timeline.ts'));
const { parseDoc } = await import(path.join(root, 'src/storage/persist.ts'));
const { loadScoreFile } = await import(path.join(root, 'scripts/lib/load-score.ts'));

const [scoreFile, docFile, work, first, last] = process.argv.slice(2);
const score = await loadScoreFile(scoreFile);
const doc = parseDoc(fs.readFileSync(docFile, 'utf8'));
const voice = JSON.parse(fs.readFileSync(`${work}/voice.json`, 'utf8')).notes as { q: number; expected: number; found: number; how: string }[];
const map = buildTimeMap({
  tempos: score.events.tempos,
  endQ: score.index.endQ,
  tempoFactor: doc.tempoFactor,
  gestures: compileGestures(doc.gestures, (a: any) => resolveAnchor(score.index, a), (q: number, st?: string) => breathWindow(score.staffSpans, q, st)),
});
const offsets = voice.map((n) => n.found - map.T(n.q)).sort((a, b) => a - b);
const offset = offsets[offsets.length >> 1];
const labels = score.index.measures.map((m: any) => m.label);
const played = score.index.played;
const q0 = played.find((p: any) => labels[p.measureIndex] === first)?.q0 ?? 0;
const q1 = [...played].reverse().find((p: any) => labels[p.measureIndex] === last)?.q1 ?? score.index.endQ;
const syllable = new Map([...score.lyrics].map(([id, s]) => [score.index.spans.get(id)?.[0]?.qOn, s]));
const barOf = (q: number) => labels[played.findLast((p: any) => p.q0 <= q + 1e-9).measureIndex];

console.log('bar  syllable      full-score   singer     file      file − singer');
for (const n of voice.filter((v) => v.q >= q0 && v.q < q1)) {
  const t = map.T(n.q) + offset;
  console.log(`${String(barOf(n.q)).padStart(3)}  ${(syllable.get(n.q) ?? '').padEnd(12)} ${n.expected.toFixed(2).padStart(8)}  ${n.found.toFixed(2).padStart(8)}  ${t.toFixed(2).padStart(8)}   ${(t - n.found >= 0 ? '+' : '') + (t - n.found).toFixed(2)}${n.how === 'dtw+attack' ? '  (snapped to an attack)' : ''}`);
}
const label = (a: any) => `m.${a.label}♩${+(a.offsetQ + 1).toFixed(2)}`;
console.log('gestures touching these bars:');
for (const g of doc.gestures as any[]) {
  const [a, b] = g.type === 'breath' ? [g.at, g.at] : [g.from, g.to];
  const [qa, qb] = [resolveAnchor(score.index, a)[0], resolveAnchor(score.index, b)[0]];
  if (qb >= q0 && qa <= q1) {
    console.log('  ' + (g.type === 'breath' ? `breath after ${label(g.at)}, +${g.extraMs} ms` : g.type === 'ramp' ? `to ${(g.target * 100).toFixed(0)}% of the basic tempo  ${label(g.from)} → ${label(g.to)}` : `${g.type}  ${label(g.from)} → ${label(g.to)}`));
  }
}
