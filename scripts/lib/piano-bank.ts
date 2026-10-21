// The pieces of scripts/build-piano.ts that don't need ffmpeg: reading the
// Salamander Grand Piano's SFZ mapping and WAV files, and measuring each
// recording (where its attack starts, how loud it is, when it has died away).

import fs from 'node:fs';

/** One recording of one key range at one velocity range, as the SFZ maps it. */
export interface SfzRegion {
  /** Path as written in the SFZ, with forward slashes. */
  sample: string;
  lokey: number;
  hikey: number;
  lovel: number;
  hivel: number;
  /** The key the recording is of. */
  key: number;
  /** Seconds the note takes to fade after the key is released (the SFZ's ampeg_release). */
  release: number;
}

/**
 * The note regions of an SFZ (those whose sample is a velocity layer, `…v<n>.wav`), with each
 * group's release. Release-triggered regions (key noise, string resonance) and pedal noise are left out.
 */
export function parseSfzNotes(text: string): SfzRegion[] {
  const out: SfzRegion[] = [];
  let group: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const head = line.trim().match(/^<(group|region)>(.*)$/);
    if (!head) continue;
    const fields = Object.fromEntries([...head[2].matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    if (head[1] === 'group') {
      group = fields;
      continue;
    }
    const all = { ...group, ...fields };
    const sample = all.sample?.replace(/\\/g, '/');
    if (!sample || !/v\d+\.wav$/i.test(sample) || all.trigger === 'release') continue;
    // SFZ defaults: the recording is of middle C (60) unless pitch_keycenter (or key) says otherwise.
    const key = Number(all.pitch_keycenter ?? all.key ?? 60);
    out.push({
      sample,
      lokey: Number(all.lokey ?? all.key ?? 0),
      hikey: Number(all.hikey ?? all.key ?? 127),
      lovel: Number(all.lovel ?? 1),
      hivel: Number(all.hivel ?? 127),
      key,
      release: Number(all.ampeg_release ?? 1),
    });
  }
  return out;
}

/** A 16-bit PCM WAV file as one float array per channel. */
export function readWav(path: string): { rate: number; channels: Float32Array[] } {
  const b = fs.readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV file`);
  let rate = 0;
  let count = 0;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      if (b.readUInt16LE(body) !== 1 || b.readUInt16LE(body + 14) !== 16) throw new Error(`${path}: only 16-bit PCM is supported`);
      count = b.readUInt16LE(body + 2);
      rate = b.readUInt32LE(body + 4);
    } else if (id === 'data') {
      const frames = Math.floor(Math.min(size, b.length - body) / (2 * count));
      const channels = Array.from({ length: count }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) channels[c][i] = b.readInt16LE(body + 2 * (i * count + c)) / 32768;
      return { rate, channels };
    }
    at = body + size + (size & 1);
  }
  throw new Error(`${path}: no audio data`);
}

export interface Measure {
  /** Sample index where the attack starts (the first sample within 40 dB of the peak). */
  onset: number;
  /** Peak level, dBFS. */
  peakDb: number;
  /** Power of the first 250 ms from the onset, dB (mean of the channels' mean squares). */
  attackDb: number;
  /** Seconds from the start of the file until the note has died away by 40 dB (50 ms windows). */
  t40: number;
}

export function measure(channels: Float32Array[], rate: number): Measure {
  const n = channels[0].length;
  const abs = (i: number) => {
    let a = 0;
    for (const c of channels) a = Math.max(a, Math.abs(c[i]));
    return a;
  };
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, abs(i));
  const threshold = peak * 10 ** (-40 / 20);
  let onset = 0;
  while (onset < n - 1 && abs(onset) <= threshold) onset++;
  const power = (from: number, to: number) => {
    let s = 0;
    for (const c of channels) for (let i = from; i < to; i++) s += c[i] * c[i];
    return s / (channels.length * Math.max(1, to - from));
  };
  const hop = Math.round(rate / 20);
  const frames = Array.from({ length: Math.floor(n / hop) }, (_, f) => 10 * Math.log10(power(f * hop, (f + 1) * hop) + 1e-20));
  const top = frames.indexOf(Math.max(...frames));
  const below = frames.findIndex((db, f) => f > top && db < frames[top] - 40);
  return {
    onset,
    peakDb: 20 * Math.log10(peak + 1e-20),
    attackDb: 10 * Math.log10(power(onset, Math.min(n, onset + Math.round(rate / 4))) + 1e-20),
    t40: below < 0 ? n / rate : below / 20,
  };
}

/**
 * The part of a recording to keep: from just before the attack until a second after it has died away
 * by 40 dB (at most `capSeconds`), scaled by `gain` and faded out over its last second.
 */
export function trim(channels: Float32Array[], rate: number, m: Measure, gain: number, capSeconds: number): Float32Array[] {
  const n = channels[0].length;
  const start = Math.max(0, m.onset - Math.round(0.002 * rate));
  const end = Math.min(n, Math.round((m.t40 + 1) * rate), start + Math.round(capSeconds * rate));
  const len = end - start;
  const fade = Math.min(rate, Math.floor(len / 4));
  return channels.map((c) => {
    const out = new Float32Array(len);
    for (let k = 0; k < len; k++) {
      const f = k < len - fade ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (k - (len - fade))) / fade);
      out[k] = c[start + k] * gain * f;
    }
    return out;
  });
}
