// Moving the selection with the arrow keys (src/score/noteNav.ts).
import { describe, expect, it } from 'vitest';
import { navNotes, noteAtOrAfter, pitchName, stepNote } from '../src/score/noteNav';

// A voice (staff 1) over a piano's right hand (staff 2: a melody over chords) and left hand (staff 3).
const parts = [
  {
    notes: [
      { id: 'v1', staff: 1, qOn: 0, midi: 72 },
      { id: 'v2', staff: 1, qOn: 2, midi: 74 },
    ],
  },
  {
    notes: [
      { id: 'r1', staff: 2, qOn: 0, midi: 67 },
      { id: 'r1a', staff: 2, qOn: 0, midi: 60 },
      { id: 'r2', staff: 2, qOn: 1, midi: 69 },
      { id: 'r2a', staff: 2, qOn: 1, midi: 62 },
      { id: 'l1', staff: 3, qOn: 0, midi: 48 },
      { id: 'l2', staff: 3, qOn: 1.5, midi: 43 },
      // The same note again on a repeat: kept once, at its first pass.
      { id: 'l1', staff: 3, qOn: 8, midi: 48 },
    ],
  },
];
const notes = navNotes(parts);
const step = (id: string, dir: Parameters<typeof stepNote>[2]) => stepNote(notes, id, dir)?.id;

describe('note navigation', () => {
  it('keeps each note once, at its first pass', () => {
    expect(notes.filter((n) => n.id === 'l1')).toEqual([{ id: 'l1', staff: 3, q: 0, midi: 48 }]);
  });

  it('follows a line along its staff, through the chords around it', () => {
    expect(step('r1', 'next')).toBe('r2'); // the melody
    expect(step('r1a', 'next')).toBe('r2a'); // the inner voice, nearest in pitch
    expect(step('r2', 'prev')).toBe('r1');
    expect(step('v2', 'next')).toBeUndefined();
    expect(step('v1', 'prev')).toBeUndefined();
  });

  it('goes up and down through a chord, then to the next staff', () => {
    expect(step('r1a', 'up')).toBe('r1');
    expect(step('r1', 'up')).toBe('v1');
    expect(step('r1', 'down')).toBe('r1a');
    expect(step('r1a', 'down')).toBe('l1');
    // From the left hand at beat 2.5, the nearest right-hand onset (the earlier on a tie), lowest note first.
    expect(step('l2', 'up')).toBe('r2a');
    expect(step('v1', 'up')).toBeUndefined();
  });

  it('starts at the top staff, at or after the playhead', () => {
    expect(noteAtOrAfter(notes, 0)?.id).toBe('v1');
    expect(noteAtOrAfter(notes, 1)?.id).toBe('v2');
    expect(noteAtOrAfter(notes, 99)?.id).toBe('v1');
  });

  it('names pitches', () => {
    expect(pitchName(60)).toBe('C4');
    expect(pitchName(75)).toBe('E♭5');
  });
});
