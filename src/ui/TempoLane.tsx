import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScoreIndex } from '../perf/anchors';
import { sectionLevelAt, type TimeMap, type TimingGesture } from '../perf/timeline';

interface Props {
  map: TimeMap;
  index: ScoreIndex;
  timing: TimingGesture[];
  selectedId?: string;
  playQ: number;
  loop?: { q0: number; q1: number };
  onSeek: (q: number) => void;
  onSelect: (gestureId: string) => void;
}

const HEIGHT = 120;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;

/** The whole piece's tempo curve, with gesture spans, breaths and the playhead. */
export function TempoLane({ map, index, timing, selectedId, playQ, loop, onSeek, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const endQ = Math.max(map.endQ, 1e-6);
  const x = (q: number) => (q / endQ) * width;
  const qOf = (px: number) => Math.min(Math.max((px / width) * endQ, 0), endQ);

  const curve = useMemo(() => {
    const n = Math.max(200, Math.min(4000, Math.round(width * 2)));
    const pts: { q: number; bpm: number; base: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const q = (i / n) * endQ;
      const bpm = map.bpmAt(q);
      pts.push({ q, bpm, base: bpm / map.ratioAt(q) });
    }
    // Make sure each breath's slowest point is drawn even when its short window falls between samples.
    for (const g of timing) {
      if (g.kind !== 'breath') continue;
      for (const q of [g.start, (g.start + g.q) / 2, g.q, (g.q + g.end) / 2, g.end]) {
        pts.push({ q, bpm: map.bpmAt(q), base: map.bpmAt(q) / map.ratioAt(q) });
      }
    }
    pts.sort((a, b) => a.q - b.q);
    const all = pts.flatMap((p) => [p.bpm, p.base]);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const pad = Math.max((hi - lo) * 0.12, 4);
    lo -= pad;
    hi += pad;
    return { pts, lo, hi };
  }, [map, timing, width, endQ]);

  const y = (bpm: number) => PAD_TOP + (1 - (bpm - curve.lo) / (curve.hi - curve.lo)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const path = (key: 'bpm' | 'base') =>
    curve.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.q).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');

  const bands = timing.map((g, i) => {
    const [lo, hi] =
      g.kind === 'breath' || g.kind === 'shape' ? [g.start, g.end] : [g.q0, g.q1];
    const cls =
      g.kind === 'ramp' ? (g.target < sectionLevelAt(timing, g.q0) ? 'slower' : 'faster') : g.kind === 'shape' ? (g.ratio < 1 ? 'broaden' : 'push') : g.kind;
    return { key: `${g.id}:${i}`, id: g.id, lo, hi, cls, breathQ: g.kind === 'breath' ? g.q : undefined };
  });

  const labelEvery = Math.max(1, Math.ceil(index.played.length / Math.max(1, width / 36)));
  const hoverInfo = hover === undefined ? undefined : describe(hover, map, index);

  const pick = (q: number) => {
    const inside = bands.filter((b) => q >= b.lo && q <= b.hi).sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
    if (inside[0]) onSelect(inside[0].id);
    onSeek(q);
  };

  return (
    <div className="tempo-lane" ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        onMouseMove={(e) => setHover(qOf(e.nativeEvent.offsetX))}
        onMouseLeave={() => setHover(undefined)}
        onClick={(e) => pick(qOf(e.nativeEvent.offsetX))}
      >
        {loop && <rect className="loop-band" x={x(loop.q0)} width={x(loop.q1) - x(loop.q0)} y={0} height={HEIGHT} />}
        {bands.map((b) => (
          <rect
            key={b.key}
            className={`band ${b.cls}${b.id === selectedId ? ' selected' : ''}`}
            x={x(b.lo)}
            width={Math.max(2, x(b.hi) - x(b.lo))}
            y={PAD_TOP - 6}
            height={HEIGHT - PAD_TOP - PAD_BOTTOM + 12}
          />
        ))}
        {index.played.map((m, i) => (
          <g key={i} className="measure-tick">
            <line x1={x(m.q0)} x2={x(m.q0)} y1={HEIGHT - PAD_BOTTOM + 2} y2={HEIGHT - PAD_BOTTOM + (i % labelEvery ? 5 : 9)} />
            {i % labelEvery === 0 && (
              <text x={x(m.q0) + 2} y={HEIGHT - 3}>
                {index.measures[m.measureIndex]?.label}
              </text>
            )}
          </g>
        ))}
        <path className="base-curve" d={path('base')} />
        <path className="tempo-curve" d={path('bpm')} />
        {bands.map((b) =>
          b.breathQ === undefined ? null : (
            <line key={`t${b.key}`} className="breath-tick" x1={x(b.breathQ)} x2={x(b.breathQ)} y1={PAD_TOP - 8} y2={PAD_TOP - 1} />
          ),
        )}
        <line className="playhead" x1={x(playQ)} x2={x(playQ)} y1={0} y2={HEIGHT} />
        {hover !== undefined && <line className="hover-line" x1={x(hover)} x2={x(hover)} y1={0} y2={HEIGHT} />}
      </svg>
      <div className="lane-readout">{hoverInfo ?? describe(playQ, map, index)}</div>
    </div>
  );
}

function describe(q: number, map: TimeMap, index: ScoreIndex): string {
  const bpm = map.bpmAt(q);
  const ratio = map.ratioAt(q);
  const m = index.played.findLast((p) => p.q0 <= q + 1e-9);
  const label = m ? `m. ${index.measures[m.measureIndex]?.label}` : '';
  const pct = Math.round((ratio - 1) * 100);
  return `${label} · ${bpm.toFixed(0)} BPM${pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''} · ${formatTime(map.T(q))}`;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
