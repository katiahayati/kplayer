// Builds kplayer's piano: a SoundFont (SF3, Ogg Vorbis samples) from the Salamander Grand
// Piano V3 (Alexander Holm, CC-BY 3.0), a Yamaha C5 recorded in stereo at 16 strike strengths.
// scripts/fetch-soundfont.sh downloads the samples and runs this; it needs ffmpeg with libvorbis.
//
// Usage: npx tsx scripts/build-piano.ts <folder with SalamanderGrandPianoV3.sfz> out.sf3 [--only regex]
//
// Every recording is scaled to the loudness of the hardest strike of its key, so how loud a note
// plays follows the SoundFont velocity curve, as with any General MIDI piano (kplayer's dynamics
// assume it), while the recording chosen by velocity gives its tone: soft strikes are darker.
// Recordings are cut a second after they have died away by 40 dB, and the silence before the
// attack is dropped.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BasicInstrument, BasicPreset, BasicSample, BasicSoundBank, GeneratorTypes, SampleTypes } from 'spessasynth_core';
import { measure, parseSfzNotes, readWav, trim, type Measure } from './lib/piano-bank';

const CAP_SECONDS = 12;
/** Release after the key is let go (SoundFont timecents): the damper, or the ring of the top strings, which have none. */
const DAMPED_RELEASE = -387; // 0.8 s
const UNDAMPED_RELEASE = 2400; // 4 s

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt < 0 ? undefined : new RegExp(args.splice(onlyAt, 2)[1]);
const [dir, out] = args;
if (!out) throw new Error('Usage: build-piano.ts <folder with SalamanderGrandPianoV3.sfz> out.sf3 [--only regex]');

const regions = parseSfzNotes(fs.readFileSync(path.join(dir, 'SalamanderGrandPianoV3.sfz'), 'utf8')).filter((r) => !only || only.test(r.sample));
if (!regions.length) throw new Error('No note regions found');

// Pass 1: measure every recording; the hardest strike of each key sets that key's level.
const measures = new Map<string, Measure>();
const top = new Map<number, { hivel: number; attackDb: number }>();
regions.forEach((r, i) => {
  const { rate, channels } = readWav(path.join(dir, r.sample));
  const m = measure(channels, rate);
  measures.set(r.sample, m);
  if ((top.get(r.key)?.hivel ?? -1) < r.hivel) top.set(r.key, { hivel: r.hivel, attackDb: m.attackDb });
  if (i % 64 === 0) process.stderr.write(`measuring ${i + 1}/${regions.length}\r`);
});
const gainDb = (r: (typeof regions)[number]) => top.get(r.key)!.attackDb - measures.get(r.sample)!.attackDb;
// One gain for the whole bank keeps the loudest scaled recording 1 dB below full scale.
const headroom = Math.min(0, -1 - Math.max(...regions.map((r) => measures.get(r.sample)!.peakDb + gainDb(r))));

const bank = new BasicSoundBank();
Object.assign(bank.soundBankInfo, {
  name: 'Salamander Grand Piano (kplayer)',
  copyright: 'Salamander Grand Piano V3 by Alexander Holm, CC-BY 3.0 (https://archive.org/details/SalamanderGrandPianoV3)',
  comment: 'Built by kplayer scripts/build-piano.ts: every strike scaled to its key\'s loudest, trimmed after a 40 dB decay.',
  version: { major: 3, minor: 0 },
  // Fixed, so building again from the same recordings gives the same file.
  creationDate: new Date('2026-10-21T00:00:00Z'),
});
const inst = new BasicInstrument();
inst.name = 'Salamander Grand';
inst.globalZone.setGenerator(GeneratorTypes.releaseVolEnv, DAMPED_RELEASE);
bank.addInstruments(inst);

const encode = (data: Float32Array, rate: number) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-fflags', '+bitexact', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '6', '-flags:a', '+bitexact', '-fflags', '+bitexact', '-f', 'ogg', 'pipe:1']);
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.stderr.on('data', (c: Buffer) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`ffmpeg: ${err}`))));
    p.stdin.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });

// Pass 2: trim, level and encode each recording, a few at a time; then add them in the SFZ's order,
// each as a linked left/right pair, so the same samples always build the same file.
let done = 0;
let frames = 0;
async function encodePair(r: (typeof regions)[number]): Promise<{ rate: number; length: number; ogg: Uint8Array[] }> {
  const { rate, channels } = readWav(path.join(dir, r.sample));
  if (channels.length !== 2) throw new Error(`${r.sample}: expected stereo`);
  const halves = trim(channels, rate, measures.get(r.sample)!, 10 ** ((gainDb(r) + headroom) / 20), CAP_SECONDS);
  frames += halves[0].length;
  const ogg = await Promise.all(halves.map((h) => encode(h, rate)));
  if (++done % 16 === 0) process.stderr.write(`encoding ${done}/${regions.length}\r`);
  return { rate, length: halves[0].length, ogg };
}
const encoded: Awaited<ReturnType<typeof encodePair>>[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.max(1, Math.min(4, os.cpus().length)) }, async () => {
    for (let i = next++; i < regions.length; i = next++) encoded[i] = await encodePair(regions[i]);
  }),
);
regions.forEach((r, i) => {
  const { rate, length, ogg } = encoded[i];
  const name = path.basename(r.sample, '.wav');
  const [left, right] = ([['L', SampleTypes.leftSample, -500], ['R', SampleTypes.rightSample, 500]] as const).map(([side, type, pan], c) => {
    const s = new BasicSample(`${name}${side}`, rate, r.key, 0, type, 0, length - 1);
    s.setCompressedData(ogg[c]);
    bank.addSamples(s);
    const z = inst.createZone(s);
    z.keyRange = { min: r.lokey, max: r.hikey };
    z.velRange = { min: r.lovel, max: r.hivel };
    z.setGenerator(GeneratorTypes.overridingRootKey, r.key);
    z.setGenerator(GeneratorTypes.pan, pan);
    if (r.release > 2) z.setGenerator(GeneratorTypes.releaseVolEnv, UNDAMPED_RELEASE);
    return s;
  });
  left.setLinkedSample(right, SampleTypes.leftSample);
});

const preset = new BasicPreset(bank);
preset.name = 'Grand Piano';
preset.program = 0;
preset.bankMSB = 0;
preset.createZone(inst);
bank.addPresets(preset);

fs.writeFileSync(out, new Uint8Array(bank.writeSF2({ software: 'kplayer build-piano' })));
console.error(
  `wrote ${out}: ${regions.length} recordings (${(frames / 44100 / 60).toFixed(0)} stereo minutes), ` +
    `${(fs.statSync(out).size / 1e6).toFixed(0)} MB; level ${headroom.toFixed(1)} dB`,
);
