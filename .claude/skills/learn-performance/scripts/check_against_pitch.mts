// How close are the alignments and performance files to the singer's pitch-measured note starts (pitch_truth.py)?
// Files are lined up with the recording at bar 1, the way you hear them playing along. Run from the project root:
//   npx tsx .claude/skills/learn-performance/scripts/check_against_pitch.mts score.mxl analysis/X file.kplayer.json ...
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const { breathWindow, resolveAnchor } = await import(path.join(root, 'src/perf/anchors.ts'));
const { compileGestures } = await import(path.join(root, 'src/perf/compile.ts'));
const { buildTimeMap } = await import(path.join(root, 'src/perf/timeline.ts'));
const { parseDoc } = await import(path.join(root, 'src/storage/persist.ts'));
const { loadScoreFile } = await import(path.join(root, 'scripts/lib/load-score.ts'));
const [scoreFile, W, ...docs] = process.argv.slice(2);
const truth = JSON.parse(fs.readFileSync(`${W}/truth.json`, 'utf8')) as { q: number; t: number }[];
const interp = (on: [number, number][], q: number) => { let i = on.findIndex((o) => o[0] > q); if (i <= 0) i = 1; const [a, b] = [on[i - 1], on[i]]; return a[1] + ((q - a[0]) / (b[0] - a[0])) * (b[1] - a[1]); };
const stats = (name: string, f: (q: number) => number) => {
  const e = truth.map((r) => f(r.q) - r.t);
  const abs = e.map(Math.abs).sort((a, b) => a - b);
  const p = (x: number) => abs[Math.floor(x * (abs.length - 1))];
  const mean = e.reduce((s, x) => s + x, 0) / e.length;
  console.log(`${name.padEnd(46)} median ${p(0.5).toFixed(2)} s, 90% within ${p(0.9).toFixed(2)} s, worst ${p(1).toFixed(2)} s, mean bias ${(mean >= 0 ? '+' : '') + mean.toFixed(2)} s`);
};
for (const tag of fs.readdirSync(W).filter((f) => /^alignment.*\.json$/.test(f))) {
  const on = JSON.parse(fs.readFileSync(`${W}/${tag}`, 'utf8')).onsets as [number, number][];
  stats(`full-score ${tag}`, (q) => interp(on, q));
}
for (const tag of fs.readdirSync(W).filter((f) => /^voice.*\.json$/.test(f))) {
  const v = new Map((JSON.parse(fs.readFileSync(`${W}/${tag}`, 'utf8')).notes as { q: number; found: number }[]).map((n) => [n.q, n.found]));
  stats(`singer ${tag}`, (q) => v.get(q) ?? NaN);
}
const score = await loadScoreFile(scoreFile);
const start = interp(JSON.parse(fs.readFileSync(`${W}/alignment.json`, 'utf8')).onsets, 0);
for (const d of docs) {
  const doc = parseDoc(fs.readFileSync(d, 'utf8'));
  const map = buildTimeMap({ tempos: score.events.tempos, endQ: score.index.endQ, tempoFactor: doc.tempoFactor,
    gestures: compileGestures(doc.gestures, (a: any) => resolveAnchor(score.index, a), (q: number, st?: string) => breathWindow(score.staffSpans, q, st)) });
  stats(`file ${path.basename(d)}, started with bar 1`, (q) => map.T(q) + start);
}
