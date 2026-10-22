import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { baseId } from '../perf/anchors';
import type { Playhead } from '../ui/playhead';
import type { LoadedScore } from './verovio';

export interface BreathMarker {
  gestureId: string;
  /** Score position of the breath (first pass). */
  q: number;
  /** What it is, for screen readers and the tooltip: "Breath after m. 3, ♩4, 300 ms". */
  label: string;
  selected: boolean;
  clamped: boolean;
  /** Switched off: kept, but not played. */
  off: boolean;
}

interface Props {
  score: LoadedScore;
  /** The pages to show: the score's own, or laid out again for a narrow screen. */
  pages: string[];
  playhead: Playhead;
  playing: boolean;
  /** Base IDs shown as selected. */
  selectedIds: ReadonlySet<string>;
  /** Base IDs shown as inside the selected range or gesture. */
  rangeIds: ReadonlySet<string>;
  breaths: BreathMarker[];
  /** Waiting for a click on a note (e.g. to set a shape's peak). */
  picking?: boolean;
  onNoteClick: (id: string, opts: { shift: boolean; double: boolean }) => void;
  onBreathClick: (gestureId: string) => void;
}

export function ScoreView({ score, pages, playhead, playing, selectedIds, rangeIds, breaths, picking, onNoteClick, onBreathClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, Element | null>());
  const [markerPos, setMarkerPos] = useState<{ marker: BreathMarker; left: number; top: number }[]>([]);

  useEffect(() => elements.current.clear(), [score, pages]);
  const el = (id: string): Element | null => {
    const cache = elements.current;
    if (!cache.has(id)) cache.set(id, pagesRef.current?.querySelector(`[id="${CSS.escape(id)}"]`) ?? null);
    return cache.get(id)!;
  };

  // Which notes sound at each timemap entry, so the playhead can light them up.
  const sounding = useMemo(() => {
    const qs: number[] = [];
    const active: string[][] = [];
    const now = new Set<string>();
    for (const e of score.timemap) {
      for (const id of e.off ?? []) now.delete(id);
      for (const id of e.on ?? []) now.add(id);
      qs.push(e.qstamp);
      active.push([...new Set([...now].map(baseId))]);
    }
    return { qs, active };
  }, [score]);

  // Notes by the position they end at (first pass), for placing breath markers.
  const endingAt = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [id, spans] of score.index.spans) {
      const key = spans[0].qOff.toFixed(4);
      m.set(key, [...(m.get(key) ?? []), id]);
    }
    return m;
  }, [score]);

  const lit = useRef<Element[]>([]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // Light the notes sounding at the playhead. The playhead moves every frame, so this follows it directly
  // rather than through React, and touches the score only when the timemap entry (the set of notes) changes.
  useEffect(() => {
    const { qs, active } = sounding;
    let shown = -2;
    const update = () => {
      const q = playhead.get();
      let lo = 0;
      let hi = qs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (qs[mid] <= q + 1e-9) lo = mid;
        else hi = mid - 1;
      }
      const at = qs.length && qs[lo] <= q + 1e-9 ? lo : -1;
      if (at === shown) return;
      shown = at;
      const next = (at >= 0 ? active[at] : []).map(el).filter((e): e is Element => !!e);
      for (const e of lit.current) if (!next.includes(e)) e.classList.remove('playing');
      for (const e of next) e.classList.add('playing');
      lit.current = next;

      const scroller = scrollRef.current;
      const first = next[0]?.closest('.system') ?? next[0];
      if (playingRef.current && scroller && first) {
        const r = first.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        if (r.top < s.top || r.bottom > s.bottom) {
          scroller.scrollTo({ top: scroller.scrollTop + r.top - s.top - 24, behavior: smoothScroll() });
        }
      }
    };
    update();
    return playhead.subscribe(update);
  }, [playhead, sounding, pages]);

  useEffect(() => {
    toggleClass(pagesRef.current, 'selected', selectedIds);
    // Keep the selection in sight (it moves off-screen when the arrow keys walk it along).
    const last = [...selectedIds].map(el).filter((e): e is Element => !!e).at(-1);
    const scroller = scrollRef.current;
    if (!last || !scroller) return;
    const r = last.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (r.top < s.top || r.bottom > s.bottom) last.scrollIntoView?.({ block: 'center', behavior: smoothScroll() });
  }, [selectedIds, score, pages]);
  useEffect(() => toggleClass(pagesRef.current, 'in-range', rangeIds), [rangeIds, score, pages]);

  useLayoutEffect(() => {
    const wrap = pagesRef.current;
    if (!wrap) return;
    const place = () => {
      const base = wrap.getBoundingClientRect();
      setMarkerPos(
        breaths.flatMap((marker) => {
          const ids = endingAt.get(marker.q.toFixed(4)) ?? [];
          const rects = ids
            .map(el)
            .filter((e): e is Element => !!e)
            .map((e) => ({ e, r: e.getBoundingClientRect() }))
            .sort((a, b) => a.r.top - b.r.top);
          if (!rects.length) return [];
          const { e, r } = rects[0];
          const sys = (e.closest('.system') ?? e).getBoundingClientRect();
          return [{ marker, left: r.right - base.left + 6, top: sys.top - base.top - 4 }];
        }),
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [breaths, endingAt, score, pages]);

  const handleClick = (ev: React.MouseEvent, double: boolean) => {
    const hit = (ev.target as Element).closest('g.note, g.rest, g.mRest') ?? nearestNote(ev.clientX, ev.clientY);
    if (hit?.id) onNoteClick(baseId(hit.id), { shift: ev.shiftKey, double });
  };

  /**
   * SVG only takes clicks on painted pixels, which misses the hollow middle of
   * half and whole notes and most of a thin rest. So a click within about a
   * staff space and a half of a notehead or rest selects the nearest one; a
   * tap, with a fingertip's reach.
   */
  const nearestNote = (x: number, y: number): Element | undefined => {
    const root = pagesRef.current;
    if (!root) return undefined;
    // A notehead is about one staff space tall, whatever the zoom.
    const space = root.querySelector('g.note .notehead')?.getBoundingClientRect().height || 8;
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const reach = touch ? Math.max(22, space * 2.5) : Math.max(8, space * 1.6);
    let best: Element | undefined;
    let bestDist = Infinity;
    for (const el of root.querySelectorAll('g.note, g.rest, g.mRest')) {
      const r = (el.querySelector('.notehead') ?? el).getBoundingClientRect();
      const dist = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (dist <= reach && dist < bestDist) {
        best = el;
        bestDist = dist;
      }
    }
    return best;
  };

  return (
    <div
      className="score-scroll"
      ref={scrollRef}
      tabIndex={0}
      aria-label="Score. Arrow keys move between notes, Shift with an arrow selects a passage, Enter plays from the selection."
    >
      <div className={`score-pages${picking ? ' picking' : ''}`} ref={pagesRef} onClick={(e) => handleClick(e, false)} onDoubleClick={(e) => handleClick(e, true)}>
        <Pages pages={pages} />
        {markerPos.map(({ marker, left, top }) => (
          <button
            key={marker.gestureId}
            className={`breath-marker${marker.selected ? ' selected' : ''}${marker.clamped ? ' clamped' : ''}${marker.off ? ' off' : ''}`}
            style={{ left, top }}
            title={marker.label}
            aria-label={marker.label}
            onClick={(e) => {
              e.stopPropagation();
              onBreathClick(marker.gestureId);
            }}
          >
            ,
          </button>
        ))}
      </div>
    </div>
  );
}

/** Each page in a box of its own, so the browser can skip drawing the pages that are off-screen. */
const Pages = memo(function Pages({ pages }: { pages: string[] }) {
  return <div className="svg-pages" dangerouslySetInnerHTML={{ __html: pages.map((p) => `<div class="page">${p}</div>`).join('') }} />;
});

/** Smooth scrolling, unless the system asks for reduced motion. */
const smoothScroll = (): ScrollBehavior =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function toggleClass(root: HTMLElement | null, cls: string, ids: ReadonlySet<string>) {
  if (!root) return;
  for (const e of root.querySelectorAll(`.${cls}`)) if (!ids.has(e.id)) e.classList.remove(cls);
  for (const id of ids) root.querySelector(`[id="${CSS.escape(id)}"]`)?.classList.add(cls);
}
