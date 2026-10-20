// The piano's texture bar by bar, as kplayer sees it: for each staff (s1 = right hand) and voice (L =
// MusicXML voice / MEI layer), how many notes start, their range and their lengths in quarter notes.
// Run from the project root:
//   npx tsx .claude/skills/expressive-piano/scripts/texture.mts score.mxl [--part N]
// The part defaults to the one named Piano (else the last). Bars where the line-up changes are where
// voicing rules need bar ranges.
import path from 'node:path';

const root = process.cwd();
const { loadScoreFile } = await import(path.join(root, 'scripts/lib/load-score.ts'));

const args = process.argv.slice(2);
const partArg = args.indexOf('--part') >= 0 ? Number(args.splice(args.indexOf('--part'), 2)[1]) : undefined;
const score = await loadScoreFile(args[0]);
const parts = score.events.parts;
const part = parts.find((p: any) => p.index === partArg) ?? parts.find((p: any) => /piano/i.test(p.name)) ?? parts[parts.length - 1];
const name = (m: number) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
const played = score.index.played;
const labels = score.index.measures.map((m: any) => m.label);
console.log(`part ${part.index} (${part.name})`);
let last = '';
for (const bar of played) {
  const notes = part.notes.filter((n: any) => n.qOn >= bar.q0 - 1e-6 && n.qOn < bar.q1 - 1e-6);
  const groups = new Map<string, any[]>();
  for (const n of notes) {
    const k = `s${part.tracks.indexOf(n.staff - 1) + 1}L${n.layer ?? '?'}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const line = [...groups.entries()]
    .sort()
    .map(([k, v]) => {
      const lens = [...new Set(v.map((n) => +(n.qOff - n.qOn).toFixed(2)))].sort((a, b) => a - b).join('/');
      const pitches = v.map((n) => n.midi);
      return `${k}: ${v.length} ${name(Math.min(...pitches))}–${name(Math.max(...pitches))} len ${lens}`;
    })
    .join(' | ');
  // Bars just like the one before are summarised.
  const shape = line.replace(/[A-G]#?-?\d/g, '').replace(/\d+ /g, '');
  console.log(`bar ${String(labels[bar.measureIndex]).padStart(3)}${shape === last ? '  (same layout)' : ''}: ${line || 'rest'}`);
  last = shape;
}
