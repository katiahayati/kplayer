// How loud each note plays. Verovio's MIDI gives every note one velocity, so on
// its own a pianissimo tremolo plays as loud as the melody it accompanies. This
// gives each note its part's written dynamic (with hairpins, and any dynamics
// the performance adds), then the performance's voicing on top: which strands
// of the texture lead and which recede. It also lays down sustain pedal and
// marks the notes that should sound slightly ahead.
//
// Levels are MIDI velocities; voice levels are decibels relative to them. A
// SoundFont synth turns velocity v into a gain of 40·log10(v/127) dB (the
// standard velocity-to-attenuation curve), so a decibel offset is a velocity
// ratio and keeps meaning the same thing at pp and at ff.

import { pairSpans } from './compile';
import type { ScoreControl, ScoreEvents, ScoreNote, ScorePart } from './render';
import type { Anchor, DynamicsDoc, NoteSelector, VoiceRule } from './types';
import type { DynamicMark, HairpinMark } from '../score/mei';

/** Velocities of the written markings: MusicXML's defaults, as MuseScore exports them. */
export const MARKING_VELOCITY: Record<string, number> = {
  pppp: 10,
  ppp: 18,
  pp: 32,
  p: 49,
  mp: 64,
  mf: 72,
  f: 88,
  ff: 101,
  fff: 113,
  ffff: 124,
  fp: 49,
  sfp: 49,
};
/** Before a part's first dynamic. */
const DEFAULT_LEVEL = MARKING_VELOCITY.mf;
const LADDER = [18, 32, 49, 64, 72, 88, 101, 113];
/** How long after a pedal change the pedal goes down again, in quarter notes. */
const PEDAL_CATCH_Q = 0.08;

export interface DynamicsInput {
  events: ScoreEvents;
  /** The score's own dynamics and hairpins. */
  marks: DynamicMark[];
  hairpins: HairpinMark[];
  doc?: DynamicsDoc;
  resolve: (a: Anchor) => number[];
  /** Start of every played measure, for pedalling by the bar. */
  barStarts: number[];
}

export const velocityGain = (db: number) => 10 ** (db / 40);
const levelOf = (l: string | number | undefined): number | undefined =>
  typeof l === 'number' ? l : l === undefined ? undefined : MARKING_VELOCITY[l.trim().toLowerCase()];
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

type LevelEvent = { kind: 'mark'; q: number; level: number } | { kind: 'ramp'; q: number; q1: number; to: number };

/** A part's dynamic level (MIDI velocity) at each score position. */
export function levelCurve(events: LevelEvent[]): (q: number) => number {
  const sorted = [...events].sort((a, b) => a.q - b.q || (a.kind === 'mark' ? -1 : 1));
  return (q) => {
    let level = DEFAULT_LEVEL;
    for (const e of sorted) {
      if (e.q > q + 1e-9) break;
      if (e.kind === 'mark') level = e.level;
      else if (q >= e.q1) level = e.to;
      else level = level ** (1 - (q - e.q) / (e.q1 - e.q)) * e.to ** ((q - e.q) / (e.q1 - e.q));
    }
    return level;
  };
}

/** The written and added dynamics of each part, as level curves. */
export function partLevels(input: DynamicsInput): Map<number, (q: number) => number> {
  const { events, doc, resolve } = input;
  const partOfStaff = new Map<number, number>();
  for (const p of events.parts) for (const t of p.tracks) partOfStaff.set(t + 1, p.index);
  const out = new Map<number, (q: number) => number>();
  for (const part of events.parts) {
    const forPart = (p: number | undefined) => p === undefined || p === part.index;
    const marks: { q: number; level: number }[] = [];
    const ownShape = [...(doc?.marks ?? []), ...(doc?.hairpins ?? [])].some((g) => forPart(g.part));
    const written = doc?.written !== false || !ownShape;
    for (const m of written ? input.marks : []) {
      const level = levelOf(m.velocity ?? m.text) ?? levelOf(m.text);
      if (level !== undefined && partOfStaff.get(m.staff) === part.index) marks.push({ q: m.q, level });
    }
    for (const m of doc?.marks ?? []) {
      const level = levelOf(m.level);
      if (level !== undefined && forPart(m.part)) for (const q of resolve(m.at)) marks.push({ q, level });
    }
    marks.sort((a, b) => a.q - b.q);

    const ramps: { q0: number; q1: number; form: 'cres' | 'dim'; level?: number }[] = [];
    for (const h of written ? input.hairpins : []) if (partOfStaff.get(h.staff) === part.index) ramps.push({ ...h });
    for (const h of doc?.hairpins ?? []) {
      if (!forPart(h.part)) continue;
      for (const [q0, q1] of pairSpans(resolve(h.from), resolve(h.to))) if (q1 > q0) ramps.push({ q0, q1, form: h.form, level: levelOf(h.level) });
    }
    const levelEvents: LevelEvent[] = marks.map((m) => ({ kind: 'mark', ...m }));
    for (const r of ramps.sort((a, b) => a.q0 - b.q0)) {
      const from = levelCurve(levelEvents)(r.q0);
      // Arrive at the dynamic written where the hairpin ends (or within a beat after), else one marking further.
      const next = marks.find((m) => m.q >= r.q1 - 1e-6 && m.q <= r.q1 + 1);
      const further = r.form === 'cres' ? LADDER.find((l) => l > from * 1.05) ?? from : [...LADDER].reverse().find((l) => l < from / 1.05) ?? from;
      levelEvents.push({ kind: 'ramp', q: r.q0, q1: r.q1, to: r.level ?? next?.level ?? further });
    }
    out.set(part.index, levelCurve(levelEvents));
  }
  return out;
}

/** Which notes each voice rule covers, by part and note index. */
function voiceMembers(rule: VoiceRule, part: ScorePart, resolve: (a: Anchor) => number[], endQ: number): Set<number> {
  const s: NoteSelector = rule.select;
  const members = new Set<number>();
  if (s.part !== undefined && s.part !== part.index) return members;
  const spans = rule.from || rule.to ? pairSpans(rule.from ? resolve(rule.from) : [0], rule.to ? resolve(rule.to) : [endQ + 1]) : [[-Infinity, Infinity] as [number, number]];
  const eps = 1e-6;
  const candidates: number[] = [];
  part.notes.forEach((n, i) => {
    if (!spans.some(([lo, hi]) => n.qOn >= lo - eps && n.qOn < hi - eps)) return;
    const staff = n.staff === undefined ? undefined : part.tracks.indexOf(n.staff - 1) + 1;
    if (s.staff && (staff === undefined || !s.staff.includes(staff))) return;
    if (s.layer && (n.layer === undefined || !s.layer.includes(n.layer))) return;
    if (s.tremolo !== undefined && !!n.tremolo !== s.tremolo) return;
    if (s.minPitch !== undefined && n.midi < s.minPitch) return;
    if (s.maxPitch !== undefined && n.midi > s.maxPitch) return;
    if (s.minLength !== undefined && n.qOff - n.qOn < s.minLength - 0.01) return;
    if (s.maxLength !== undefined && n.qOff - n.qOn > s.maxLength + 0.01) return;
    candidates.push(i);
  });
  if (!s.top && !s.bottom) return new Set(candidates);
  // Highest / lowest of the notes starting together (within a tick of Verovio's MIDI grid).
  const byOnset = new Map<number, number[]>();
  for (const i of candidates) {
    const t = Math.round(part.notes[i].qOn * 120);
    byOnset.set(t, [...(byOnset.get(t) ?? []), i]);
  }
  for (const group of byOnset.values()) {
    const pitches = group.map((i) => part.notes[i].midi);
    const want = s.top ? Math.max(...pitches) : Math.min(...pitches);
    for (const i of group) if (part.notes[i].midi === want) members.add(i);
  }
  return members;
}

/** A fixed pseudo-random number in [−1, 1] for a note, so variation is the same on every playback. */
function noise(part: number, i: number): number {
  let h = (i * 2654435761) ^ (part * 40503);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * Where to change the pedal in [q0, q1), beat by beat: wherever a beat brings a new bass note or a pitch
 * class the beat before didn't have. Beats that only repeat the harmony (repeated chords, a held
 * melody) stay under one pedal; moving figures get a fresh pedal each beat instead of blurring.
 */
function harmonyChanges(notes: ScoreNote[], q0: number, q1: number): number[] {
  // Each beat's notes, filed in one pass: those starting in it and those sounding in it.
  const first = Math.floor(q0 + 1e-9);
  const count = Math.max(0, Math.ceil(q1 - 1e-9) - first);
  const starting: ScoreNote[][] = Array.from({ length: count }, () => []);
  const sounding: ScoreNote[][] = Array.from({ length: count }, () => []);
  for (const n of notes) {
    if (n.qOff <= q0 || n.qOn >= q1) continue;
    const s = Math.max(0, Math.floor(n.qOn + 1e-6) - first);
    const e = Math.min(count - 1, Math.ceil(n.qOff - 1e-6) - first - 1);
    for (let b = s; b <= e; b++) {
      const lo = Math.max(first + b, q0);
      const hi = Math.min(first + b + 1, q1);
      if (n.qOn < hi - 1e-6 && n.qOff > lo + 1e-6) sounding[b].push(n);
    }
    if (n.qOn >= q0 - 1e-6 && s < count && n.qOn < Math.min(first + s + 1, q1) - 1e-6) starting[s].push(n);
  }
  const changes: number[] = [];
  let prev: Set<number> | undefined;
  let prevBass = -1;
  for (let b = 0; b < count; b++) {
    if (!starting[b].length) continue;
    const bass = Math.min(...sounding[b].map((n) => n.midi)) % 12;
    const fresh = starting[b].some((n) => !prev?.has(n.midi % 12));
    if (prev && (bass !== prevBass || fresh)) changes.push(Math.min(...starting[b].map((n) => n.qOn)));
    prev = new Set(sounding[b].map((n) => n.midi % 12));
    prevBass = bass;
  }
  return changes;
}

function pedalEvents(part: ScorePart, input: DynamicsInput): ScoreControl[] {
  const out: ScoreControl[] = [];
  for (const span of input.doc?.pedal ?? []) {
    if (span.enabled === false || (span.part !== undefined && span.part !== part.index)) continue;
    for (const [q0, q1] of pairSpans(input.resolve(span.from), input.resolve(span.to))) {
      if (q1 <= q0) continue;
      if (span.mode === 'off') {
        out.push({ number: 64, value: 0, q: q0 });
        continue;
      }
      const changes =
        span.mode === 'harmony'
          ? harmonyChanges(part.notes, q0, q1)
          : span.mode === 'beat'
            ? Array.from({ length: Math.ceil(q1 - q0) - 1 }, (_, i) => q0 + i + 1)
            : input.barStarts.filter((b) => b > q0 + 1e-6 && b < q1 - 1e-6);
      out.push({ number: 64, value: 1, q: q0 + PEDAL_CATCH_Q });
      for (const c of changes) out.push({ number: 64, value: 0, q: c }, { number: 64, value: 1, q: c + PEDAL_CATCH_Q });
      out.push({ number: 64, value: 0, q: q1 });
    }
  }
  return out;
}

/** The score's events with each note's velocity (and lead) from the dynamics, plus pedal. */
export function shapeDynamics(input: DynamicsInput): ScoreEvents {
  const { events, doc, resolve } = input;
  const levels = partLevels(input);
  const rules = (doc?.voices ?? []).filter((r) => r.enabled !== false);
  const leadSec = (doc?.leadMs ?? 20) / 1000;
  const parts = events.parts.map((part) => {
    const level = levels.get(part.index)!;
    const voiceOf = new Map<number, VoiceRule>();
    for (const rule of rules) for (const i of voiceMembers(rule, part, resolve, events.endQ)) voiceOf.set(i, rule);
    const notes = part.notes.map((n, i): ScoreNote => {
      const rule = voiceOf.get(i);
      const db = (rule?.gainDb ?? 0) + (rule?.varyDb ? rule.varyDb * noise(part.index, i) : 0);
      const velocity = clamp(Math.round(level(n.qOn) * velocityGain(db)), 1, 127) / 127;
      // Ahead for a leading voice; a little either way for a jittered one (a different draw from its level's).
      const ahead = (rule?.lead ? leadSec : 0) + (rule?.jitterMs ? (rule.jitterMs / 1000) * noise(part.index + 7919, i) : 0);
      return { ...n, velocity, leadSec: ahead || undefined, voice: rule?.id };
    });
    const pedal = pedalEvents(part, input);
    const controls = pedal.length ? [...part.controls.filter((c) => c.number !== 64), ...pedal].sort((a, b) => a.q - b.q) : part.controls;
    return { ...part, notes, controls };
  });
  return { ...events, parts };
}
