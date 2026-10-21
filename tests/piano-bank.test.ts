// Building the piano from the Salamander samples (scripts/build-piano.ts): reading its SFZ
// mapping, and measuring and trimming recordings.
import { describe, expect, it } from 'vitest';
import { measure, parseSfzNotes, trim } from '../scripts/lib/piano-bank';

describe('piano bank', () => {
  it('reads note regions, with SFZ defaults and each group’s release', () => {
    const sfz = [
      '<group> amp_veltrack=73 ampeg_release=1',
      '<region> sample=44.1khz16bit\\A3v1.wav lokey=56 hikey=58 lovel=1 hivel=26 pitch_keycenter=57',
      // Salamander leaves out pitch_keycenter for C4: the SFZ default is 60.
      '<region> sample=44.1khz16bit\\C4v16.wav lokey=59 hikey=61 lovel=121',
      '<group> amp_veltrack=73 ampeg_release=5',
      '<region> sample=44.1khz16bit\\F#6v2.wav key=90 lovel=27 hivel=34',
      '<group> trigger=release volume=-37',
      '<region> sample=44.1khz16bit\\rel1.wav lokey=21 hikey=21',
      '<region> sample=44.1khz16bit\\harmLA0v1.wav lokey=21 hikey=22',
      '<group> group=1 on_locc64=126',
      '<region> sample=44.1khz16bit\\pedalD1.wav',
    ].join('\n');
    expect(parseSfzNotes(sfz)).toEqual([
      { sample: '44.1khz16bit/A3v1.wav', lokey: 56, hikey: 58, lovel: 1, hivel: 26, key: 57, release: 1 },
      { sample: '44.1khz16bit/C4v16.wav', lokey: 59, hikey: 61, lovel: 121, hivel: 127, key: 60, release: 1 },
      { sample: '44.1khz16bit/F#6v2.wav', lokey: 90, hikey: 90, lovel: 27, hivel: 34, key: 90, release: 5 },
    ]);
  });

  // A stereo note after 10 ms of silence, decaying 20 dB a second.
  const rate = 8000;
  const note = [0, 0.3].map((phase) =>
    Float32Array.from({ length: rate * 4 }, (_, i) => {
      const t = i / rate - 0.01;
      return t < 0 ? 0 : 0.5 * 10 ** (-t) * Math.sin(2 * Math.PI * 220 * t + phase);
    }),
  );

  it('finds the attack, its level, and when the note has died away by 40 dB', () => {
    const m = measure(note, rate);
    expect(m.onset / rate).toBeCloseTo(0.01, 3);
    expect(m.peakDb).toBeCloseTo(20 * Math.log10(0.5), 0);
    // A sine's power is half its amplitude squared; the first 250 ms average a little lower.
    expect(m.attackDb).toBeLessThan(10 * Math.log10(0.125));
    expect(m.attackDb).toBeGreaterThan(10 * Math.log10(0.125) - 3);
    expect(m.t40).toBeGreaterThan(1.95);
    expect(m.t40).toBeLessThan(2.15);
  });

  it('keeps from just before the attack to a second after the 40 dB point, fading out, scaled', () => {
    const m = measure(note, rate);
    const [l, r] = trim(note, rate, m, 2, 12);
    expect(l.length).toBe(r.length);
    expect(l.length / rate).toBeCloseTo(m.t40 + 1 - m.onset / rate + 0.002, 2);
    expect(l[l.length - 1]).toBeCloseTo(0, 6);
    const at = Math.round(0.05 * rate);
    expect(l[at]).toBeCloseTo(2 * note[0][at - Math.round(0.002 * rate) + m.onset], 6);
    expect(trim(note, rate, m, 1, 0.5)[0].length).toBe(rate / 2); // the cap
  });
});
