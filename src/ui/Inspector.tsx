import { useEffect, useRef } from 'react';
import { playedMeasureAt, resolveAnchor, type ScoreIndex } from '../perf/anchors';
import { BREATH_PRESETS, type BreathPresetKey } from '../perf/presets';
import type { BreathResult } from '../perf/timeline';
import type { Anchor, BreathGesture, Gesture, RampGesture, ShapeGesture } from '../perf/types';

export type SectionKind = 'slower' | 'faster' | 'broaden' | 'push' | 'aTempo';
/** Where a Slow down / Speed up starts from, for showing it in tempo terms. */
export interface RampInfo {
  /** The tempo the earlier sections leave, as a fraction of the basic tempo. */
  from: number;
  /** That tempo in BPM, and the basic tempo where the section arrives. */
  fromBpm: number;
  basicBpm: number;
}
/** A note being picked for a shape: where its peak arrives, or where its return begins. */
export type PickField = 'peakAt' | 'holdUntil';

interface Props {
  index: ScoreIndex;
  /** What's selected in the score, when it isn't a gesture. */
  noteSelection?: { from: Anchor; to: Anchor; single: boolean };
  gesture?: Gesture;
  gestures: Gesture[];
  /** Where each gesture acts, in score positions (one span per pass). */
  spans: Map<string, { lo: number; hi: number }[]>;
  rampInfo: Map<string, RampInfo>;
  /** The playhead, in score position. */
  playQ: number;
  breathResults: BreathResult[];
  /** Written breath marks in the score that aren't breaths yet. */
  unusedBreathMarks: number;
  loopOn: boolean;
  onImportBreathMarks: () => void;
  onAddBreath: () => void;
  onAddSection: (kind: SectionKind) => void;
  onChange: (id: string, patch: Partial<Gesture>, key: string) => void;
  onDelete: (id: string) => void;
  /** Removes every gesture (undoable). */
  onClearAll: () => void;
  onToggleLoop: () => void;
  picking?: PickField;
  onPick: (field?: PickField) => void;
  onSelect: (id: string) => void;
}

export function Inspector(p: Props) {
  return (
    <aside className="inspector">
      {p.gesture ? <GestureEditor {...p} gesture={p.gesture} /> : <SelectionActions {...p} />}
      <GestureList {...p} />
    </aside>
  );
}

function SelectionActions({ noteSelection, unusedBreathMarks, onImportBreathMarks, onAddBreath, onAddSection }: Props) {
  if (!noteSelection) {
    return (
      <section className="panel hint">
        <h2>Shape the performance</h2>
        {unusedBreathMarks > 0 && (
          <div className="actions">
            <button className="primary" onClick={onImportBreathMarks}>
              Use the score's {unusedBreathMarks} breath mark{unusedBreathMarks > 1 ? 's' : ''}
            </button>
          </div>
        )}
        <p>Click a note, then press <kbd>B</kbd> to breathe after it.</p>
        <p>Click a note and shift-click another to mark a section that slows down, speeds up, broadens or pushes forward.</p>
        <p>Double-click a note to play from there.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>{noteSelection.single ? 'Note' : 'Section'}</h2>
      <p className="muted">
        {noteSelection.single ? anchorLabel(noteSelection.to) : `${anchorLabel(noteSelection.from)} → ${anchorLabel(noteSelection.to)}`}
      </p>
      <div className="actions">
        <button onClick={onAddBreath} title="Breath after this note (B)">
          Breathe after <kbd>B</kbd>
        </button>
      </div>
      <h3>Tempo section {noteSelection.single && <span className="muted">(shift-click to extend)</span>}</h3>
      <div className="actions grid">
        <button onClick={() => onAddSection('slower')}>Slow down</button>
        <button onClick={() => onAddSection('faster')}>Speed up</button>
        <button onClick={() => onAddSection('broaden')}>Broaden</button>
        <button onClick={() => onAddSection('push')}>Push forward</button>
        <button onClick={() => onAddSection('aTempo')}>A tempo</button>
      </div>
    </section>
  );
}

function GestureEditor({ gesture: g, rampInfo, breathResults, loopOn, onChange, onDelete, onToggleLoop, picking, onPick }: Props & { gesture: Gesture }) {
  const set = (patch: Partial<Gesture>, field: string) => onChange(g.id, patch, `${g.id}:${field}`);
  return (
    <section className="panel">
      <h2>{gestureTitle(g, rampInfo)}</h2>
      <p className="muted">{g.type === 'breath' ? `After ${anchorLabel(g.at)}` : `${anchorLabel(g.from)} → ${anchorLabel(g.to)}`}</p>

      {g.type === 'breath' && <BreathFields g={g} result={breathResults.find((r) => r.id === g.id)} set={set} />}
      {g.type === 'ramp' && <RampFields g={g} info={rampInfo.get(g.id)} set={set} />}
      {g.type === 'shape' && <ShapeFields g={g} set={set} picking={picking} onPick={onPick} />}
      {g.type === 'aTempo' && <p className="muted">Eases back to the basic tempo over this section.</p>}

      <div className="actions">
        <button className={loopOn ? 'active' : ''} onClick={onToggleLoop} title="Loop from a measure before to a measure after (L)">
          {loopOn ? 'Stop looping' : 'Loop around'} <kbd>L</kbd>
        </button>
        <label className="check">
          <input type="checkbox" checked={g.enabled !== false} onChange={(e) => set({ enabled: e.target.checked }, 'enabled')} />
          On
        </label>
        <button className="danger" onClick={() => onDelete(g.id)} title="Delete (Del)">
          Delete
        </button>
      </div>
    </section>
  );
}

type Setter = (patch: Partial<Gesture>, field: string) => void;

function BreathFields({ g, result, set }: { g: BreathGesture; result?: BreathResult; set: Setter }) {
  return (
    <>
      <div className="presets">
        {(Object.keys(BREATH_PRESETS) as BreathPresetKey[]).map((k) => {
          const { label, extraMs } = BREATH_PRESETS[k];
          return (
            <button key={k} className={extraMs === g.extraMs ? 'active' : ''} onClick={() => set({ extraMs }, 'preset')}>
              {label}
            </button>
          );
        })}
      </div>
      <Slider label="Extra time" value={g.extraMs} min={0} max={1500} step={10} unit=" ms" onChange={(v) => set({ extraMs: v }, 'extraMs')} />
      <p className="muted">
        Broadens from the note before the breath to the note after it, slowest at the breath. Everything else stays in
        tempo.
      </p>
      {result && (
        <p className={result.clamped ? 'warn' : 'muted'}>
          {result.clamped
            ? `Capped at ${Math.round(result.addedSec * 1000)} ms: those two notes can only stretch so far.`
            : `Adds ${Math.round(result.addedSec * 1000)} ms; slowest point ${Math.round(result.minRatio * 100)}% of the tempo.`}
        </p>
      )}
    </>
  );
}

function RampFields({ g, info, set }: { g: RampGesture; info?: RampInfo; set: Setter }) {
  const pct = Math.round(g.target * 100);
  return (
    <>
      <Slider label="Arrive at" value={pct} min={20} max={Math.max(200, pct)} step={1} unit="%" onChange={(v) => set({ target: v / 100 }, 'target')} />
      <p className="muted">
        Of the basic tempo
        {info && `, from ${Math.round(info.from * 100)}%: ♩ = ${Math.round(info.fromBpm)} → ${Math.round(g.target * info.basicBpm)}`}. Holds it until the next
        section. Changing or deleting earlier sections doesn't move it.
      </p>
    </>
  );
}

function ShapeFields({ g, set, picking, onPick }: { g: ShapeGesture; set: Setter; picking?: PickField; onPick: (f?: PickField) => void }) {
  const pickButton = (field: PickField, label: string) => (
    <button className={picking === field ? 'active' : ''} onClick={() => onPick(picking === field ? undefined : field)}>
      {picking === field ? 'Click a note…' : label}
    </button>
  );
  const picked = (field: PickField, a: Anchor) => (
    <span className="chip">
      {anchorLabel(a)}
      <button onClick={() => set({ [field]: undefined }, field)} title="Clear">
        ×
      </button>
    </span>
  );
  return (
    <>
      <div className="presets">
        <button className={g.gesture === 'broaden' ? 'active' : ''} onClick={() => set({ gesture: 'broaden' }, 'gesture')}>
          Broaden
        </button>
        <button className={g.gesture === 'push' ? 'active' : ''} onClick={() => set({ gesture: 'push' }, 'gesture')}>
          Push forward
        </button>
      </div>
      <Slider label="Amount" value={Math.round(g.amount * 100)} min={1} max={40} step={1} unit="%" onChange={(v) => set({ amount: v / 100 }, 'amount')} />
      {g.peakAt ? (
        <div className="pick-row">
          <span>Peak on</span>
          {picked('peakAt', g.peakAt)}
          {pickButton('peakAt', 'Change')}
        </div>
      ) : (
        <>
          <Slider label="Peak" value={Math.round(g.peak * 100)} min={20} max={100} step={5} unit="%" onChange={(v) => set({ peak: v / 100 }, 'peak')} />
          <div className="pick-row">
            <span />
            {pickButton('peakAt', 'Peak on a note instead')}
          </div>
        </>
      )}
      <div className="pick-row">
        <span>Hold until</span>
        {g.holdUntil ? picked('holdUntil', g.holdUntil) : <span className="muted">the peak</span>}
        {pickButton('holdUntil', g.holdUntil ? 'Change' : 'Pick note')}
      </div>
      {picking && (
        <p className="hint-pick">
          Click the note {picking === 'peakAt' ? 'where the peak arrives' : 'where the return to tempo begins'}. <kbd>Esc</kbd> cancels.
        </p>
      )}
      <Slider label="Settle after" value={g.releaseQ} min={0} max={4} step={0.25} unit=" ♩" onChange={(v) => set({ releaseQ: v }, 'releaseQ')} />
      <p className="muted">
        {g.gesture === 'push' ? 'Gathers momentum' : 'Opens up'} toward the peak
        {g.holdUntil ? ', holds it until the hold note,' : ','} then returns to the surrounding tempo by the end
        {g.releaseQ ? ', plus the settle time' : ''}.
      </p>
    </>
  );
}

/**
 * Every gesture, in score order, marked against the playhead: "now" for those
 * acting at the playhead, "holding" for the Slow down / Speed up / A tempo
 * whose tempo is still in force after it ended, and a playhead marker between
 * gestures when none is acting.
 */
function GestureList({ gestures, gesture, onSelect, onClearAll, spans, rampInfo, playQ, index }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const eps = 1e-9;
  const start = (g: Gesture) => resolveAnchor(index, g.type === 'breath' ? g.at : g.from)[0] ?? Infinity;
  const sorted = [...gestures].sort((a, b) => start(a) - start(b) || order(a) - order(b));
  const now = new Set(sorted.filter((g) => (spans.get(g.id) ?? []).some((s) => playQ >= s.lo - eps && playQ < s.hi - eps)).map((g) => g.id));
  // The tempo you hear between sections was set by the last one to finish before the playhead.
  const tempoSetters = sorted.filter((g) => g.type === 'ramp' || g.type === 'aTempo');
  const finished = (g: Gesture) => Math.max(-Infinity, ...(spans.get(g.id) ?? []).filter((s) => s.hi <= playQ + eps).map((s) => s.hi));
  const holding = tempoSetters.some((g) => now.has(g.id))
    ? undefined
    : tempoSetters.filter((g) => finished(g) > -Infinity).sort((a, b) => finished(b) - finished(a))[0]?.id;
  // With nothing acting at the playhead, mark where it sits in the list.
  const markerAt = now.size ? -1 : (() => {
    const i = sorted.findIndex((g) => start(g) > playQ + eps);
    return i === -1 ? sorted.length : i;
  })();
  const bar = playedMeasureAt(index, playQ);
  const focus = now.size ? [...now].join() : `${holding ?? ''}|${markerAt}`;

  useEffect(() => {
    listRef.current?.querySelector('.now, .holding, .playhead-marker')?.scrollIntoView?.({ block: 'nearest' });
  }, [focus]);

  if (!gestures.length) return null;
  const marker = (
    <li key="playhead" className="playhead-marker">
      playhead{bar ? `, m. ${index.measures[bar.measureIndex]?.label}` : ''}
    </li>
  );
  return (
    <section className="panel list">
      <div className="list-head">
        <h3>In this performance</h3>
        <button
          className="danger small"
          title="Remove every breath and section (Ctrl+Z undoes it)"
          onClick={() => {
            const n = gestures.length;
            if (confirm(`Remove all ${n} breath${n === 1 ? '' : 's'} and section${n === 1 ? '' : 's'}? Ctrl+Z undoes it.`)) onClearAll();
          }}
        >
          Clear all
        </button>
      </div>
      <ul ref={listRef}>
        {sorted.flatMap((g, i) => {
          const state = now.has(g.id) ? ' now' : g.id === holding ? ' holding' : '';
          const item = (
            <li key={g.id}>
              <button className={`${g.id === gesture?.id ? 'active' : ''}${g.enabled === false ? ' off' : ''}${state}`} onClick={() => onSelect(g.id)}>
                <span className={`swatch ${swatch(g, rampInfo)}`} />
                <span>
                  {gestureTitle(g, rampInfo)} <span className="muted">{g.type === 'breath' ? `after ${anchorLabel(g.at)}` : `${anchorLabel(g.from)} → ${anchorLabel(g.to)}`}</span>
                </span>
                {state && <span className={`tag${state}`}>{state === ' now' ? 'now' : 'holding'}</span>}
              </button>
            </li>
          );
          return i === markerAt ? [marker, item] : [item];
        })}
        {markerAt === sorted.length && marker}
      </ul>
    </section>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <output>
        {p.value}
        {p.unit}
      </output>
    </label>
  );
}

export function anchorLabel(a: Anchor): string {
  const beat = Math.round((a.offsetQ + 1) * 100) / 100;
  return `m. ${a.label ?? a.measureIndex + 1}, ♩${beat}`;
}

/** Whether a Slow down / Speed up goes slower or faster than the tempo it starts from. */
const rampDir = (g: RampGesture, rampInfo: Map<string, RampInfo>) => (g.target < (rampInfo.get(g.id)?.from ?? 1) ? 'slower' : 'faster');

function gestureTitle(g: Gesture, rampInfo: Map<string, RampInfo>): string {
  switch (g.type) {
    case 'breath':
      return `Breath · ${g.extraMs} ms`;
    case 'ramp':
      return `${rampDir(g, rampInfo) === 'slower' ? 'Slow down' : 'Speed up'} to ${Math.round(g.target * 100)}%`;
    case 'shape':
      return `${g.gesture === 'broaden' ? 'Broaden' : 'Push forward'} · ${Math.round(g.amount * 100)}%`;
    case 'aTempo':
      return 'A tempo';
  }
}

function swatch(g: Gesture, rampInfo: Map<string, RampInfo>): string {
  if (g.type === 'ramp') return rampDir(g, rampInfo);
  if (g.type === 'shape') return g.gesture;
  return g.type;
}

function order(g: Gesture): number {
  const a = g.type === 'breath' ? g.at : g.from;
  return a.measureIndex * 1000 + a.offsetQ;
}
