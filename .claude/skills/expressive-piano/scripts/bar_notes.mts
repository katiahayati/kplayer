// Every note of some bars, all parts, by position in the bar (quarter notes): pitch, staff (s1 = upper),
// voice (L) and length. For the bars a texture survey flags as unusual. Run from the project root:
//   npx tsx .claude/skills/expressive-piano/scripts/bar_notes.mts score.mxl BAR [BAR…]
import path from 'node:path';

const root = process.cwd();
const { loadScoreFile } = await import(path.join(root, 'scripts/lib/load-score.ts'));

const [file, ...want] = process.argv.slice(2);
const score = await loadScoreFile(file);
const name = (m: number) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
const labels = score.index.measures.map((m: any) => m.label);
for (const bar of score.index.played.filter((b: any) => want.includes(String(labels[b.measureIndex])))) {
  for (const part of score.events.parts) {
    const at = new Map<number, string[]>();
    for (const n of part.notes.filter((n: any) => n.qOn >= bar.q0 - 1e-6 && n.qOn < bar.q1 - 1e-6)) {
      const k = +(n.qOn - bar.q0).toFixed(2);
      at.set(k, [...(at.get(k) ?? []), `${name(n.midi)} s${part.tracks.indexOf(n.staff - 1) + 1}L${n.layer ?? '?'} ${+(n.qOff - n.qOn).toFixed(2)}`]);
    }
    if (at.size) console.log(`bar ${labels[bar.measureIndex]}, ${part.name}: ${[...at.entries()].map(([k, v]) => `${k}[${v.join(', ')}]`).join(' ')}`);
  }
}
