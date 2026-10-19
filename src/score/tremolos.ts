// Verovio's MIDI export plays a fingered (two-note) tremolo as its two written
// notes, one after the other, each held for half the span. (Single-note
// tremolos it already plays as repeated notes.) These helpers read the fingered
// tremolos from Verovio's MEI and turn those notes back into the rapid
// alternation the score asks for.

import type { Span } from '../perf/anchors';
import type { ScoreEvents, ScoreNote } from '../perf/render';

export interface Tremolo {
  /** Note IDs of the first side (a chord has several). */
  first: string[];
  /** Note IDs of the second side. */
  second: string[];
  /** Length of each alternating note, in quarter notes (0.125 for 32nds). */
  unit: number;
}

/** Fingered tremolos (`fTrem`) in an MEI document. */
export function findTremolos(mei: string): Tremolo[] {
  const out: Tremolo[] = [];
  for (const [, attrs, body] of mei.matchAll(/<fTrem\b([^>]*)>([\s\S]*?)<\/fTrem>/g)) {
    const sides = [...body.matchAll(/<chord\b[^>]*>[\s\S]*?<\/chord>|<note\b[^>]*?\/>|<note\b[^>]*>[\s\S]*?<\/note>/g)].map((c) => [
      ...c[0].matchAll(/<note\b[^>]*\bxml:id="([^"]+)"/g),
    ].map((n) => n[1]));
    if (!sides[0]?.length || !sides[1]?.length) continue;
    const unitdur = /\bunitdur="(\d+)"/.exec(attrs)?.[1];
    const beams = /\bbeams="(\d+)"/.exec(attrs)?.[1];
    // Unmeasured (no beam count) is played as 32nds.
    out.push({ first: sides[0], second: sides[1], unit: unitdur ? 4 / Number(unitdur) : beams ? 2 ** -Number(beams) : 0.125 });
  }
  return out;
}

/**
 * Replaces each tremolo's two written notes with their alternation, on every
 * pass through repeats. Any part of a tied note that continues past the tremolo
 * is kept as a held note.
 */
export function expandTremolos(
  events: ScoreEvents,
  tremolos: Tremolo[],
  pitchOf: (id: string) => number | undefined,
  spansOf: (id: string) => Span[],
): ScoreEvents {
  const parts = events.parts.map((p) => ({ ...p, notes: [...p.notes] }));
  const eps = 1e-6;
  for (const t of tremolos) {
    const pitches = (ids: string[]) => ids.map(pitchOf).filter((p): p is number => p !== undefined);
    const [firstPitches, secondPitches] = [pitches(t.first), pitches(t.second)];
    const secondSpans = spansOf(t.second[0]);
    spansOf(t.first[0]).forEach((first, pass) => {
      const second: Span | undefined = secondSpans[pass];
      const q0 = first.qOn;
      const q1 = (second ?? first).qOff;
      const isWritten = (n: ScoreNote) =>
        (Math.abs(n.qOn - first.qOn) < eps && firstPitches.includes(n.midi)) ||
        (second !== undefined && Math.abs(n.qOn - second.qOn) < eps && secondPitches.includes(n.midi));
      for (const part of parts) {
        const written = part.notes.filter(isWritten);
        if (!written.length) continue;
        part.notes = part.notes.filter((n) => !isWritten(n));
        for (let q = q0, i = 0; q < q1 - eps; q += t.unit, i++) {
          for (const midi of i % 2 ? secondPitches : firstPitches) {
            // Each alternating note keeps the staff, voice and ID of the written note it repeats.
            const source = written.find((n) => n.midi === midi) ?? written[0];
            part.notes.push({ ...source, midi, qOn: q, qOff: Math.min(q + t.unit, q1), tremolo: true });
          }
        }
        for (const n of written) if (n.qOff > q1 + 0.05) part.notes.push({ ...n, qOn: q1 });
        break;
      }
    });
  }
  for (const p of parts) p.notes.sort((a, b) => a.qOn - b.qOn || a.midi - b.midi);
  return { ...events, parts };
}
