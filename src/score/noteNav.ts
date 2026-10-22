// Moving the selection from note to note with the keyboard. Left and right go
// along a staff to the next or previous onset, keeping to the note nearest in
// pitch, so a line is followed through the chords around it; up and down go
// through a chord, then to the staff above or below.

export interface NavNote {
  id: string;
  /** Staff number, counting every part's staves from 1. */
  staff: number;
  /** Onset (first pass), in quarter notes. */
  q: number;
  midi: number;
}

export type NavDir = 'next' | 'prev' | 'up' | 'down';

const EPS = 1e-6;

/** Every written note once (its first pass), by staff, then time, then from the top of each chord down. */
export function navNotes(parts: { notes: { id?: string; staff?: number; qOn: number; midi: number }[] }[]): NavNote[] {
  const byId = new Map<string, NavNote>();
  for (const p of parts) {
    for (const n of p.notes) {
      if (!n.id || n.staff === undefined) continue;
      const had = byId.get(n.id);
      if (!had || n.qOn < had.q) byId.set(n.id, { id: n.id, staff: n.staff, q: n.qOn, midi: n.midi });
    }
  }
  return [...byId.values()].sort((a, b) => a.staff - b.staff || a.q - b.q || b.midi - a.midi);
}

/** The note one step from `id` in a direction, or undefined at the edge of the score. */
export function stepNote(notes: NavNote[], id: string, dir: NavDir): NavNote | undefined {
  const cur = notes.find((n) => n.id === id);
  if (!cur) return undefined;
  const nearestPitch = (group: NavNote[]) => group.reduce((a, b) => (Math.abs(b.midi - cur.midi) < Math.abs(a.midi - cur.midi) ? b : a));

  if (dir === 'next' || dir === 'prev') {
    const staff = notes.filter((n) => n.staff === cur.staff);
    const onsets = staff.filter((n) => (dir === 'next' ? n.q > cur.q + EPS : n.q < cur.q - EPS));
    if (!onsets.length) return undefined;
    const q = dir === 'next' ? Math.min(...onsets.map((n) => n.q)) : Math.max(...onsets.map((n) => n.q));
    return nearestPitch(onsets.filter((n) => Math.abs(n.q - q) < EPS));
  }

  // Up and down: first through the chord, then to the next staff that has notes.
  const up = dir === 'up';
  const chord = notes.filter((n) => n.staff === cur.staff && Math.abs(n.q - cur.q) < EPS && (up ? n.midi > cur.midi : n.midi < cur.midi));
  if (chord.length) return nearestPitch(chord);
  const staves = [...new Set(notes.map((n) => n.staff))].filter((s) => (up ? s < cur.staff : s > cur.staff)).sort((a, b) => (up ? b - a : a - b));
  for (const s of staves) {
    const there = notes.filter((n) => n.staff === s);
    if (!there.length) continue;
    // The onset nearest in time (the earlier one on a tie), then the note of it nearest the one we came from.
    const q = there.reduce((a, b) => (Math.abs(b.q - cur.q) < Math.abs(a.q - cur.q) - EPS ? b : a)).q;
    const at = there.filter((n) => Math.abs(n.q - q) < EPS);
    return at.reduce((a, b) => (up ? (b.midi < a.midi ? b : a) : b.midi > a.midi ? b : a));
  }
  return undefined;
}

/** Where the keyboard starts when nothing is selected: the top staff's first note at or after the playhead. */
export function noteAtOrAfter(notes: NavNote[], q: number): NavNote | undefined {
  const later = notes.filter((n) => n.q >= q - EPS);
  const pool = later.length ? later : notes;
  return pool.reduce<NavNote | undefined>((best, n) => (!best || n.staff < best.staff || (n.staff === best.staff && n.q < best.q - EPS) ? n : best), undefined);
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** "E♭5": MIDI pitch as a name with its octave (middle C is C4). */
export const pitchName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
