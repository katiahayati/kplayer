// Phase 0 spike: load a MusicXML file in Verovio (Node) and print what the
// timing pipeline depends on. Usage: npm run spike -- fixtures/song.musicxml
import fs from 'node:fs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import tonejs from '@tonejs/midi';

const file = process.argv[2] ?? 'fixtures/song.musicxml';
const VerovioModule = await createVerovioModule();
const tk = new VerovioToolkit(VerovioModule);
tk.setOptions({ breaks: 'auto', pageWidth: 2100, scale: 40 });
if (!tk.loadData(fs.readFileSync(file, 'utf8'))) throw new Error('Verovio could not load ' + file);
console.log('version', tk.getVersion(), 'pages', tk.getPageCount());

const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true });
console.log('\n== timemap (first 12 of', timemap.length, ')');
for (const e of timemap.slice(0, 12)) console.log(JSON.stringify(e));
console.log('last', JSON.stringify(timemap.at(-1)));

const svg = tk.renderToSVG(1);
const classes = new Map();
for (const m of svg.matchAll(/<g[^>]*\bid="([^"]+)"[^>]*\bclass="([^"]+)"/g)) {
  const c = m[2].split(' ')[0];
  if (!classes.has(c)) classes.set(c, m[1]);
}
console.log('\n== SVG <g> classes (first id each)');
console.log([...classes.entries()].map(([c, id]) => `${c}:${id}`).join('  '));
for (const c of ['measure', 'staff', 'layer', 'note', 'breath', 'chord', 'tie']) {
  const id = classes.get(c);
  if (id) console.log(c, 'attr', tk.getElementAttr(id));
}

const firstNote = timemap.find((e) => e.on?.length)?.on[0];
if (firstNote) {
  console.log('\ngetTimesForElement', JSON.stringify(tk.getTimesForElement(firstNote)));
  tk.renderToMIDI();
  console.log('getMIDIValuesForElement', JSON.stringify(tk.getMIDIValuesForElement(firstNote)));
}

const midi = new tonejs.Midi(Buffer.from(tk.renderToMIDI(), 'base64'));
console.log('\n== MIDI ppq', midi.header.ppq, 'tempos', JSON.stringify(midi.header.tempos));
midi.tracks.forEach((t, i) => {
  const ccs = Object.entries(t.controlChanges).map(([n, l]) => `${n}x${l.length}`);
  console.log(`track ${i} name="${t.name}" ch=${t.channel} prog=${t.instrument.number} notes=${t.notes.length} cc=[${ccs}]`);
  for (const n of t.notes.slice(0, 6)) console.log(`   q=${n.ticks / midi.header.ppq} len=${n.durationTicks / midi.header.ppq} midi=${n.midi} vel=${n.velocity.toFixed(2)}`);
});
const lastQ = Math.max(...midi.tracks.flatMap((t) => t.notes.map((n) => (n.ticks + n.durationTicks) / midi.header.ppq)));
console.log('end q', lastQ, '(5 bars of 4/4 = 20; with repeat expanded = 28)');
