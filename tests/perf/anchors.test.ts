import { describe, expect, it } from 'vitest';
import { breathWindow, type Span } from '../../src/perf/anchors';

// Staff 1: "horcht" = half note tied to an eighth (two noteheads), "der" = eighth, "Hei-" = whole note.
// Staff 2: piano eighths.
const voice: Span[] = [
  { qOn: 65, qOff: 67 },
  { qOn: 67, qOff: 67.5 },
  { qOn: 67.5, qOff: 68 },
  { qOn: 68, qOff: 72 },
];
const piano: Span[] = Array.from({ length: 16 }, (_, i) => ({ qOn: 64 + i * 0.5, qOff: 64.5 + i * 0.5 }));
const spans = new Map([
  ['1', voice],
  ['2', piano],
]);

describe('breathWindow', () => {
  it("spans the last notehead before the breath and the note after, in the breath's staff", () => {
    expect(breathWindow(spans, 67.5, '1')).toEqual({ start: 67, end: 68 });
  });

  it('never reaches back into the first part of a tied note', () => {
    expect(breathWindow(spans, 67.5, '1')!.start).toBeGreaterThanOrEqual(67);
  });

  it('extends over a long note after the breath', () => {
    expect(breathWindow(spans, 68, '1')).toEqual({ start: 67.5, end: 72 });
  });

  it('mirrors the window at the end of the piece', () => {
    expect(breathWindow(spans, 72, '1')).toEqual({ start: 68, end: 76 });
  });

  it('uses the shortest notes around the breath when the staff is unknown', () => {
    expect(breathWindow(spans, 67.5)).toEqual({ start: 67, end: 68 });
  });
});
