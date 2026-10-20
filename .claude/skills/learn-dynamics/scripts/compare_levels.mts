// The piano's dynamic level (MIDI velocity, before the voicing) at each bar line and half-way through
// the bar, for several voicings or performance files side by side: the print's marks against what each
// recording's fit learned. Run from the project root:
//   npx tsx .claude/skills/learn-dynamics/scripts/compare_levels.mts score.mxl [--part N] FILE [FILE…]
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const { resolveAnchor } = await import(path.join(root, 'src/perf/anchors.ts'));
const { partLevels } = await import(path.join(root, 'src/perf/dynamics.ts'));
const { loadScoreFile } = await import(path.join(root, 'scripts/lib/load-score.ts'));

const args = process.argv.slice(2);
const partArg = args.indexOf('--part') >= 0 ? Number(args.splice(args.indexOf('--part'), 2)[1]) : undefined;
const [scoreFile, ...files] = args;
const score = await loadScoreFile(scoreFile);
const parts = score.events.parts;
const part = parts.find((p: any) => p.index === partArg) ?? parts.find((p: any) => /piano/i.test(p.name)) ?? parts[parts.length - 1];
const bars = score.index.played;
const labels = score.index.measures.map((m: any) => m.label);
const curves = files.map((f) => {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const doc = raw.dynamics ?? raw;
  const input = { events: score.events, marks: score.dynamics, hairpins: score.hairpins, doc, resolve: (a: any) => resolveAnchor(score.index, a), barStarts: bars.map((b: any) => b.q0) };
  return partLevels(input).get(part.index)!;
});
const w = 24;
// Files are named after the score; show what comes after its name.
const stem = path.basename(scoreFile).replace(/\.[^.]+$/, '') + '.';
console.log('bar  ' + files.map((f) => path.basename(f).replace(stem, '').replace(/\.(kplayer\.)?json$/, '').slice(0, w - 1).padEnd(w)).join(''));
for (const bar of bars) {
  const mid = (bar.q0 + bar.q1) / 2;
  console.log(String(labels[bar.measureIndex]).padStart(3) + '  ' + curves.map((c) => `${Math.round(c(bar.q0))} → ${Math.round(c(mid))}`.padEnd(w)).join(''));
}
