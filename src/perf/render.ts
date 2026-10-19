// Score events in, performance MIDI out. The score's MIDI (from Verovio) gives
// every note a score position; the time map turns those into seconds; the
// result is written as a "flat-time" MIDI with a single fixed tempo, so the
// sequencer plays our timing verbatim.

// Default import: the package is CommonJS, and Node (unlike Vite) can't see its named exports.
import tonejs from '@tonejs/midi';
import type { TempoPoint, TimeMap } from './timeline';
import type { PartSetting } from './types';

export interface ScoreNote {
  midi: number;
  /** 0..1 */
  velocity: number;
  qOn: number;
  qOff: number;
  /** Staff number, counting every part's staves from 1 (the MIDI track + 1). */
  staff?: number;
  /** The score note this plays (the first of a tie) and its voice (MEI layer); absent if it couldn't be matched. */
  id?: string;
  layer?: number;
  /** One of the rapid alternating notes a fingered tremolo is played as. */
  tremolo?: boolean;
  /** Sound this many seconds ahead of the beat (a melody brought out); negative is behind. */
  leadSec?: number;
  /** The performance voice (VoiceRule id) that set its level, if any. */
  voice?: string;
}

export interface ScoreControl {
  number: number;
  /** 0..1 */
  value: number;
  q: number;
}

/** One instrument: Verovio writes a track per staff, and staves of one instrument share a channel. */
export interface ScorePart {
  /** Position among the parts; the key used in PerformanceDoc.parts. */
  index: number;
  /** Track numbers in the source MIDI (staff n is track n − 1). */
  tracks: number[];
  name: string;
  channel: number;
  program: number;
  notes: ScoreNote[];
  controls: ScoreControl[];
}

export interface ScoreEvents {
  parts: ScorePart[];
  tempos: TempoPoint[];
  endQ: number;
}

/**
 * Controllers carried into the performance. Everything else is dropped; in
 * particular SpessaSynth reads CC2, CC4, CC111 and CC116–119 as loop points.
 */
const KEPT_CONTROLLERS = new Set([1, 7, 10, 11, 64, 66, 67, 91, 93]);

const PERF_BPM = 120;
const PERF_PPQ = 480;
const DEFAULT_VOLUME_CC = 100 / 127;

export function parseScoreMidi(bytes: ArrayLike<number> | ArrayBuffer): ScoreEvents {
  const midi = new tonejs.Midi(bytes);
  const ppq = midi.header.ppq;
  const tempos = midi.header.tempos.map((t) => ({ q: t.ticks / ppq, bpm: t.bpm }));
  const byChannel = new Map<number, ScorePart>();
  let endQ = 0;
  midi.tracks.forEach((t, track) => {
    if (!t.notes.length) return;
    let part = byChannel.get(t.channel);
    if (!part) {
      part = {
        index: byChannel.size,
        tracks: [],
        name: t.name || t.instrument.name || `Part ${byChannel.size + 1}`,
        channel: t.channel,
        program: t.instrument.number,
        notes: [],
        controls: [],
      };
      byChannel.set(t.channel, part);
    }
    part.tracks.push(track);
    for (const n of t.notes) {
      const note = { midi: n.midi, velocity: n.velocity, qOn: n.ticks / ppq, qOff: (n.ticks + n.durationTicks) / ppq, staff: track + 1 };
      part.notes.push(note);
      endQ = Math.max(endQ, note.qOff);
    }
    for (const cc of Object.values(t.controlChanges).flat()) {
      if (KEPT_CONTROLLERS.has(cc.number)) part.controls.push({ number: cc.number, value: cc.value, q: cc.ticks / ppq });
    }
  });
  const parts = [...byChannel.values()];
  for (const p of parts) {
    p.notes.sort((a, b) => a.qOn - b.qOn || a.midi - b.midi);
    p.controls.sort((a, b) => a.q - b.q);
  }
  return { parts, tempos, endQ };
}

export interface RenderOptions {
  parts?: Record<string, PartSetting>;
  /** Render only this score range, as a seamless loop. */
  loop?: { q0: number; q1: number };
}

export function renderPerformanceMidi(score: ScoreEvents, map: TimeMap, opts: RenderOptions = {}): Uint8Array {
  const ticksPerSec = (PERF_PPQ * PERF_BPM) / 60;
  const loop = opts.loop;
  const t0 = loop ? map.T(loop.q0) : 0;
  const toTicks = (q: number) => Math.max(0, Math.round((map.T(q) - t0) * ticksPerSec));
  const loopEnd = loop ? toTicks(loop.q1) : Infinity;

  const tracks: SmfTrack[] = [];
  for (const part of score.parts) {
    const setting = opts.parts?.[part.index] ?? { mute: false, volume: 1 };
    if (setting.mute) continue;
    const ch = part.channel & 0x0f;
    const events: SmfEvent[] = [{ tick: 0, order: 1, bytes: [0xc0 | ch, part.program & 0x7f] }];

    const notes = loop ? part.notes.filter((n) => n.qOn >= loop.q0 - 1e-9 && n.qOn < loop.q1 - 1e-9) : part.notes;
    const rendered = notes.map((n) => {
      const on = Math.max(0, toTicks(n.qOn) - Math.round((n.leadSec ?? 0) * ticksPerSec));
      // In a loop, end every note just before the loop point so nothing hangs over the jump.
      const off = Math.min(toTicks(loop ? Math.min(n.qOff, loop.q1) : n.qOff), loopEnd - 1);
      return { midi: n.midi, on, off: Math.max(off, on + 1), velocity: n.velocity };
    });
    // A note-off must not land after the next attack of the same pitch, or it would cut it short.
    const lastByPitch = new Map<number, (typeof rendered)[number]>();
    for (const n of rendered) {
      const prev = lastByPitch.get(n.midi);
      if (prev && prev.off > n.on) prev.off = Math.max(n.on, prev.on + 1);
      lastByPitch.set(n.midi, n);
    }
    for (const n of rendered) {
      events.push({ tick: n.on, order: 2, bytes: [0x90 | ch, n.midi, clamp(Math.round(n.velocity * 127), 1, 127)] });
      events.push({ tick: n.off, order: 0, bytes: [0x80 | ch, n.midi, 64] });
    }

    // In a loop, controllers set before the window collapse to its start so pedal state etc. is right.
    const controls: ScoreControl[] = [];
    if (loop) {
      const before = new Map<number, ScoreControl>();
      for (const c of part.controls) {
        if (c.q < loop.q0) before.set(c.number, c);
        else if (c.q < loop.q1) controls.push(c);
      }
      controls.unshift(...[...before.values()].map((c) => ({ ...c, q: loop.q0 })));
    } else {
      controls.push(...part.controls);
    }
    if (!controls.some((c) => c.number === 7 && c.q <= (loop?.q0 ?? 0))) {
      controls.unshift({ number: 7, value: DEFAULT_VOLUME_CC, q: loop?.q0 ?? 0 });
    }
    for (const c of controls) {
      const value = c.number === 7 ? c.value * setting.volume : c.value;
      events.push({ tick: toTicks(c.q), order: 1, bytes: [0xb0 | ch, c.number, clamp(Math.round(value * 127), 0, 127)] });
    }
    tracks.push({ name: part.name, events });
  }

  const tempo = Math.round(60e6 / PERF_BPM);
  const conductor: SmfEvent[] = [{ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, tempo >> 16, (tempo >> 8) & 0xff, tempo & 0xff] }];
  if (loop) conductor.push(marker(0, 'loopStart'), marker(loopEnd, 'loopEnd'));
  return writeSmf(PERF_PPQ, [{ events: conductor }, ...tracks]);
}

// ---- A minimal Standard MIDI File writer (format 1) ----

interface SmfEvent {
  tick: number;
  /** Tie-break at equal ticks: note-offs, then controllers, then note-ons. */
  order: number;
  bytes: number[];
}

interface SmfTrack {
  name?: string;
  events: SmfEvent[];
}

const text = (s: string) => [...new TextEncoder().encode(s)];
const marker = (tick: number, s: string): SmfEvent => ({ tick, order: 0, bytes: [0xff, 0x06, ...vlq(text(s).length), ...text(s)] });

function writeSmf(ppq: number, tracks: SmfTrack[]): Uint8Array {
  const out: number[] = [...text('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(ppq)];
  for (const t of tracks) {
    const body: number[] = [];
    if (t.name !== undefined) body.push(0, 0xff, 0x03, ...vlq(text(t.name).length), ...text(t.name));
    let last = 0;
    for (const e of [...t.events].sort((a, b) => a.tick - b.tick || a.order - b.order)) {
      body.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    body.push(0, 0xff, 0x2f, 0x00);
    out.push(...text('MTrk'), ...u32(body.length));
    for (const b of body) out.push(b);
  }
  return Uint8Array.from(out);
}

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
