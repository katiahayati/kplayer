// Shape primitives for expressive tempo gestures. All of them are built from
// smootherstep, whose first and second derivatives vanish at both ends, so a
// gesture eases in and out of the surrounding tempo with no audible corner.

/** 0 for x ≤ 0, 1 for x ≥ 1, C2-smooth in between. */
export function smootherstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Rises 0 → 1 over [q0, q1] and holds 1 afterwards. */
export function rampShape(q: number, q0: number, q1: number): number {
  if (q1 <= q0) return q >= q0 ? 1 : 0;
  return smootherstep((q - q0) / (q1 - q0));
}

/** Rises 0 → 1 over [start, peak], holds 1 until `hold`, falls 1 → 0 over [hold, end], 0 elsewhere. */
export function bumpShape(q: number, start: number, peak: number, hold: number, end: number): number {
  if (q <= start || q >= end) return 0;
  if (q <= peak) return peak > start ? smootherstep((q - start) / (peak - start)) : 1;
  if (q <= hold) return 1;
  return end > hold ? smootherstep((end - q) / (end - hold)) : 1;
}
