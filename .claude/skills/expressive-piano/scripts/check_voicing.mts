// What a voicing (or a performance file's dynamics) does to the piano, bar by bar, and what's wrong with
// it. Run from the project root:
//   npx tsx .claude/skills/expressive-piano/scripts/check_voicing.mts score.mxl voicing.json [--part N] [BAR…]
// First the problems: anchors outside the score, voices that select no notes, notes clipped at
// velocity 127, a performance file made for another score. Then, per bar: the part's level (MIDI
// velocity) at the bar line, each voice's velocities (lowest–highest, pulses included), the notes no
// voice took, and where the pedal changes (quarter notes into the bar; "off" = no pedal).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const { resolveAnchor } = await import(path.join(root, 'src/perf/anchors.ts'));
const { partLevels, shapeDynamics } = await import(path.join(root, 'src/perf/dynamics.ts'));
const { parseDoc } = await import(path.join(root, 'src/storage/persist.ts'));
const { loadScoreFile } = await import(path.join(root, 'scripts/lib/load-score.ts'));

const args = process.argv.slice(2);
const partArg = args.indexOf('--part') >= 0 ? Number(args.splice(args.indexOf('--part'), 2)[1]) : undefined;
const [scoreFile, file, ...want] = args;
const score = await loadScoreFile(scoreFile);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const doc = raw.version ? parseDoc(raw) : undefined;
const dyn = doc ? doc.dynamics : (raw.dynamics ?? raw);
if (!dyn) throw new Error(`${file} has no dynamics`);
const resolve = (a: any) => resolveAnchor(score.index, a);
const bars = score.index.played;
const labels = score.index.measures.map((m: any) => m.label);
const input = { events: score.events, marks: score.dynamics, hairpins: score.hairpins, doc: dyn, resolve, barStarts: bars.map((b: any) => b.q0) };
const shaped = shapeDynamics(input);
const parts = shaped.parts;
const part = parts.find((p: any) => p.index === partArg) ?? parts.find((p: any) => /piano/i.test(p.name)) ?? parts[parts.length - 1];
const level = partLevels(input).get(part.index)!;

// ---- Problems ----
const problems: string[] = [];
if (doc?.score && doc.score.sha256 !== score.sha256) problems.push(`made for ${doc.score.name}, a different score`);
const anchors: [string, any][] = [
  ...(doc?.gestures ?? []).flatMap((g: any) => (g.type === 'breath' ? [[g.id, g.at]] : [[g.id, g.from], [g.id, g.to]])),
  ...[...(dyn.marks ?? []), ...(dyn.hairpins ?? []), ...(dyn.pedal ?? []), ...(dyn.voices ?? []), ...(dyn.pulse ?? [])].flatMap((g: any) =>
    [g.at, g.from, g.to].filter(Boolean).map((a: any) => [g.id, a]),
  ),
];
for (const [id, a] of anchors) if (!resolve(a).length) problems.push(`${id}: bar ${a.label ?? a.measureIndex + 1}, ${a.offsetQ} is outside the score`);
const used = new Set(parts.flatMap((p: any) => p.notes.map((n: any) => n.voice)));
for (const v of dyn.voices ?? []) if (v.enabled !== false && !used.has(v.id)) problems.push(`voice ${v.id} selects no notes`);
const clipped = part.notes.filter((n: any) => n.velocity >= 1);
if (clipped.length) problems.push(`${clipped.length} notes at velocity 127 (clipped: the levels leave no room)`);
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems found');

// ---- Bar by bar ----
const pedal = part.controls.filter((c: any) => c.number === 64).sort((a: any, b: any) => a.q - b.q);
const pedalDown = (q: number) => (([...pedal].reverse().find((c: any) => c.q <= q + 1e-6)?.value ?? 0) as number) > 0;
for (const bar of bars) {
  const label = String(labels[bar.measureIndex]);
  if (want.length && !want.includes(label)) continue;
  const notes = part.notes.filter((n: any) => n.qOn >= bar.q0 - 1e-6 && n.qOn < bar.q1 - 1e-6);
  const byVoice = new Map<string, number[]>();
  for (const n of notes) byVoice.set(n.voice ?? '(none)', [...(byVoice.get(n.voice ?? '(none)') ?? []), Math.round(n.velocity * 127)]);
  const voices = [...byVoice.entries()].map(([v, xs]) => `${v} ${Math.min(...xs)}${Math.max(...xs) > Math.min(...xs) ? `–${Math.max(...xs)}` : ''}`);
  const ups = pedal.filter((c: any) => c.value === 0 && c.q > bar.q0 - 1e-6 && c.q < bar.q1 - 1e-6).map((c: any) => +(c.q - bar.q0).toFixed(2));
  const pedalText = !pedalDown(bar.q0 + 0.1) && !pedal.some((c: any) => c.value > 0 && c.q >= bar.q0 && c.q < bar.q1) ? 'off' : ups.length ? `changes at ${[...new Set(ups)].join(' ')}` : 'held';
  console.log(`bar ${label.padStart(3)}  level ${String(Math.round(level(bar.q0))).padStart(3)}  ${voices.join(', ') || 'no notes'}  · pedal ${pedalText}`);
}
