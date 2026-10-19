// Reads per-element facts out of Verovio's SVG: which staff each note is in,
// and the breath marks already written in the score. Each mark is anchored
// after the note it follows in its staff, found by comparing horizontal
// glyph positions.

import { anchorFor, baseId, type ScoreIndex } from '../perf/anchors';
import type { Anchor } from '../perf/types';

type AttrOf = (id: string) => Record<string, string>;

export interface WrittenBreath {
  at: Anchor;
  staff?: string;
}

/** Base ID of every note and rest → its staff number. */
export function staffOfElements(docs: Document[], attrOf: AttrOf): Map<string, string> {
  const out = new Map<string, string>();
  for (const doc of docs) {
    for (const staff of doc.querySelectorAll('g.staff')) {
      const n = attrOf(staff.id).n;
      if (!n) continue;
      for (const el of staff.querySelectorAll('g.note, g.rest, g.mRest')) out.set(baseId(el.id), n);
    }
  }
  return out;
}

export function findBreathMarks(docs: Document[], index: ScoreIndex, attrOf: AttrOf): WrittenBreath[] {
  const out: WrittenBreath[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const breath of doc.querySelectorAll('g.breath')) {
      const x = glyphX(breath);
      const measure = breath.closest('g.measure');
      if (x === undefined || !measure) continue;
      const staffN = attrOf(breath.id).staff?.split(' ')[0];
      const staves = [...measure.querySelectorAll('g.staff')];
      const staff = staves.find((s) => attrOf(s.id).n === staffN) ?? staves[0];
      if (!staff) continue;

      let best: { id: string; x: number } | undefined;
      for (const note of staff.querySelectorAll('g.note, g.rest')) {
        const nx = glyphX(note);
        if (nx !== undefined && nx < x && (!best || nx > best.x)) best = { id: baseId(note.id), x: nx };
      }
      const span = best && index.spans.get(best.id)?.[0];
      const measureIndex = best && index.measureOf.get(best.id);
      if (!span || measureIndex === undefined) continue;
      const at = anchorFor(index, measureIndex, span.qOff);
      const key = `${at.measureIndex}:${at.offsetQ}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ at, staff: attrOf(staff.id).n });
      }
    }
  }
  return out;
}

/** x of an element's first glyph, from its `translate(x, y)` transform. */
function glyphX(el: Element): number | undefined {
  const t = el.querySelector('use')?.getAttribute('transform');
  const m = t?.match(/translate\(\s*(-?[\d.]+)/);
  return m ? Number(m[1]) : undefined;
}
