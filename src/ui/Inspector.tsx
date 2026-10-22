import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, MousePointerClick, MoveRight, Play, PlayCircle, Repeat, Trash2 } from 'lucide-react';
import { playedMeasureAt, resolveAnchor, type ScoreIndex } from '../perf/anchors';
import { BREATH_PRESETS, type BreathPresetKey } from '../perf/presets';
import type { BreathResult } from '../perf/timeline';
import type { Anchor, BreathGesture, Gesture, RampGesture, ShapeGesture } from '../perf/types';
import { MOD, Slider, Switch } from './controls';
import { usePlayhead, type Playhead } from './playhead';

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
  playhead: Playhead;
  breathResults: BreathResult[];
  /** Written breath marks in the score that aren't breaths yet. */
  unusedBreathMarks: number;
  loopOn: boolean;
  onImportBreathMarks: () => void;
  onAddBreath: () => void;
  onAddSection: (kind: SectionKind) => void;
  /** Waiting for the note that ends a passage (shift-click without a keyboard). */
  extending?: boolean;
  onExtend?: () => void;
  /** Plays from the selected notes. */
  onPlayFrom?: () => void;
  onChange: (id: string, patch: Partial<Gesture>, key: string) => void;
  /** Switches gestures on or off without deleting them. */
  onSetEnabled: (ids: string[], on: boolean) => void;
  onDelete: (id: string) => void;
  /** Removes every gesture (undoable). */
  onClearAll: () => void;
  onToggleLoop: () => void;
  picking?: PickField;
  onPick: (field?: PickField) => void;
  onSelect: (id: string) => void;
  /** The Dynamics tab. */
  children?: ReactNode;
  /** Whether there's a voicing, to mark the Dynamics tab. */
  hasDynamics?: boolean;
}

type Tab = 'phrasing' | 'dynamics';

export function Inspector(p: Props) {
  const [tab, setTab] = useState<Tab>('phrasing');
  /** Folded away to its tabs (narrow windows only). */
  const [collapsed, setCollapsed] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 600px)').matches);
  // Selecting something opens the panel, so its actions are there.
  const selected = p.gesture?.id ?? (p.noteSelection ? 'notes' : '');
  useEffect(() => {
    if (selected) setCollapsed(false);
  }, [selected]);
  // Picking a breath or tempo change (in the score or the tempo lane) shows it.
  useEffect(() => {
    if (p.gesture) setTab('phrasing');
  }, [p.gesture?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabButton = (id: Tab, label: string, count?: ReactNode) => (
    <button
      role="tab"
      id={`tab-${id}`}
      data-tab={id}
      aria-selected={tab === id}
      aria-controls="inspector-panel"
      tabIndex={tab === id ? 0 : -1}
      className={tab === id ? 'selected' : ''}
      onClick={() => {
        setTab(id);
        setCollapsed(false);
      }}
    >
      {label}
      {count}
    </button>
  );
  return (
    <aside className={`inspector${collapsed ? ' collapsed' : ''}`}>
      <div
        className="tabs"
        role="tablist"
        aria-label="Panel"
        onKeyDown={(e) => {
          // Left and right move between the tabs, as in any tab list.
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          const next: Tab = tab === 'phrasing' ? 'dynamics' : 'phrasing';
          setTab(next);
          e.currentTarget.querySelector<HTMLElement>(`[data-tab=${next}]`)?.focus();
        }}
      >
        {tabButton('phrasing', 'Phrasing', p.gestures.length ? <span className="count">{p.gestures.length}</span> : undefined)}
        {tabButton('dynamics', 'Dynamics', p.hasDynamics ? <span className="dot" /> : undefined)}
        <button className="icon collapse" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Show the panel' : 'Hide the panel'} title={collapsed ? 'Show the panel' : 'Hide the panel'}>
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>
      {tab === 'phrasing' ? (
        <div className="tab-body" role="tabpanel" id="inspector-panel" aria-labelledby="tab-phrasing">
          {p.gesture ? <GestureEditor {...p} gesture={p.gesture} /> : <SelectionActions {...p} />}
          <GestureList {...p} />
        </div>
      ) : (
        <div className="tab-body" role="tabpanel" id="inspector-panel" aria-labelledby="tab-dynamics">
          {p.children}
        </div>
      )}
    </aside>
  );
}

function SelectionActions({ noteSelection, unusedBreathMarks, onImportBreathMarks, onAddBreath, onAddSection, extending, onExtend, onPlayFrom }: Props) {
  if (!noteSelection) {
    return (
      <section className="card hint">
        <h2>Shape the performance</h2>
        {unusedBreathMarks > 0 && (
          <button className="primary wide" onClick={onImportBreathMarks}>
            Use the score's {unusedBreathMarks} breath mark{unusedBreathMarks > 1 ? 's' : ''}
          </button>
        )}
        <ol className="steps">
          <li>
            <span className="step-icon breath">,</span>
            <span>
              Select a note, then <strong>Breathe after</strong> it (or press <kbd>B</kbd>).
            </span>
          </li>
          <li>
            <span className="step-icon">
              <MousePointerClick size={16} />
            </span>
            <span>
              Select a passage: its first note, then shift-click its last one (or use <strong>Select to…</strong>). Then slow it down, speed it up,
              broaden it or push it forward.
            </span>
          </li>
          <li>
            <span className="step-icon">
              <PlayCircle size={16} />
            </span>
            <span>Double-click a note, or use <strong>Play from here</strong>, to play from it.</span>
          </li>
        </ol>
      </section>
    );
  }
  const kinds: [SectionKind, string][] = [
    ['slower', 'Slow down'],
    ['faster', 'Speed up'],
    ['broaden', 'Broaden'],
    ['push', 'Push forward'],
    ['aTempo', 'A tempo'],
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{noteSelection.single ? 'Note' : 'Passage'}</h2>
        <span className="where">
          {noteSelection.single ? anchorLabel(noteSelection.to) : `${anchorLabel(noteSelection.from)} → ${anchorLabel(noteSelection.to)}`}
        </span>
      </div>
      <div className="note-actions">
        <button onClick={onPlayFrom} title="Play from the selected note (or double-click it)">
          <Play size={15} /> Play from here
        </button>
        <button className={extending ? 'active' : ''} onClick={onExtend} title="Then select the last note of the passage (or shift-click it)" aria-pressed={!!extending}>
          <MoveRight size={15} /> {noteSelection.single ? 'Select to…' : 'Change the end…'}
        </button>
      </div>
      {extending && (
        <p className="hint-pick">
          Select the last note of the passage. <kbd>Esc</kbd> cancels.
        </p>
      )}
      <button className="kind breath wide" onClick={onAddBreath} title="Breath after this note (B)">
        <span className="swatch breath" />
        Breathe after <kbd>B</kbd>
      </button>
      <h3>Tempo change</h3>
      {noteSelection.single && <p className="note kinds-note">Over this note, or use Select to… for a passage.</p>}
      <div className="kinds">
        {kinds.map(([kind, label]) => (
          <button key={kind} className={`kind ${kind}`} onClick={() => onAddSection(kind)}>
            <span className={`swatch ${kind}`} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function GestureEditor({ gesture: g, rampInfo, breathResults, loopOn, onChange, onDelete, onToggleLoop, picking, onPick }: Props & { gesture: Gesture }) {
  const set = (patch: Partial<Gesture>, field: string) => onChange(g.id, patch, `${g.id}:${field}`);
  return (
    <section className={`card editor ${swatch(g, rampInfo)}${g.enabled === false ? ' off' : ''}`}>
      <div className="card-head">
        <h2>
          <span className={`swatch ${swatch(g, rampInfo)}`} />
          {gestureTitle(g, rampInfo)}
        </h2>
        <span className="where">{g.type === 'breath' ? `After ${anchorLabel(g.at)}` : `${anchorLabel(g.from)} → ${anchorLabel(g.to)}`}</span>
      </div>

      {g.type === 'breath' && <BreathFields g={g} result={breathResults.find((r) => r.id === g.id)} set={set} />}
      {g.type === 'ramp' && <RampFields g={g} info={rampInfo.get(g.id)} set={set} />}
      {g.type === 'shape' && <ShapeFields g={g} set={set} picking={picking} onPick={onPick} />}
      {g.type === 'aTempo' && <p className="note">Eases back to the basic tempo over this passage.</p>}

      <div className="editor-actions">
        <button className={loopOn ? 'active' : ''} onClick={onToggleLoop} title="Loop from a measure before to a measure after (L)">
          <Repeat size={15} /> {loopOn ? 'Looping' : 'Loop'} <kbd>L</kbd>
        </button>
        <Switch label="On" checked={g.enabled !== false} onChange={(on) => set({ enabled: on }, 'enabled')} title="Hear the piece without it, keeping its settings" />
        <span className="spacer" />
        <button className="danger" onClick={() => onDelete(g.id)} title="Delete (Del)">
          <Trash2 size={15} /> Delete
        </button>
      </div>
    </section>
  );
}

type Setter = (patch: Partial<Gesture>, field: string) => void;

function BreathFields({ g, result, set }: { g: BreathGesture; result?: BreathResult; set: Setter }) {
  return (
    <>
      <div className="segmented">
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
      <p className="note">
        Broadens from the note before the breath to the note after it, slowest at the breath. Everything else stays in
        tempo.
      </p>
      {result && (
        <p className={result.clamped ? 'note warn' : 'note'}>
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
      <p className="note">
        Of the basic tempo
        {info && `, from ${Math.round(info.from * 100)}%: ♩ = ${Math.round(info.fromBpm)} → ${Math.round(g.target * info.basicBpm)}`}. Holds it until the next
        tempo change. Changing or deleting earlier ones doesn't move it.
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
      <div className="segmented">
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
      <p className="note">
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
function GestureList({ gestures, gesture, onSelect, onSetEnabled, onClearAll, spans, rampInfo, playhead, index }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const eps = 1e-9;
  const sorted = useMemo(() => {
    const start = (g: Gesture) => resolveAnchor(index, g.type === 'breath' ? g.at : g.from)[0] ?? Infinity;
    return [...gestures].map((g) => ({ g, start: start(g) })).sort((a, b) => a.start - b.start || order(a.g) - order(b.g));
  }, [gestures, index]);
  // The tempo you hear between tempo changes was set by the last one to finish before the playhead.
  const tempoSetters = useMemo(() => sorted.filter(({ g }) => g.type === 'ramp' || g.type === 'aTempo').map(({ g }) => g), [sorted]);
  // Where the playhead stands among them, as one string: the list redraws only when that changes, not every frame.
  const state = usePlayhead(playhead, (q) => {
    const now = sorted.filter(({ g }) => (spans.get(g.id) ?? []).some((s) => q >= s.lo - eps && q < s.hi - eps)).map(({ g }) => g.id);
    const finished = (g: Gesture) => Math.max(-Infinity, ...(spans.get(g.id) ?? []).filter((s) => s.hi <= q + eps).map((s) => s.hi));
    const holding = tempoSetters.some((g) => now.includes(g.id))
      ? ''
      : tempoSetters.filter((g) => finished(g) > -Infinity).sort((a, b) => finished(b) - finished(a))[0]?.id ?? '';
    // With nothing acting at the playhead, mark where it sits in the list.
    const after = sorted.findIndex(({ start }) => start > q + eps);
    const markerAt = now.length ? -1 : after === -1 ? sorted.length : after;
    return [now.join(','), holding, markerAt, playedMeasureAt(index, q)?.measureIndex ?? -1].join('|');
  });
  const [nowIds, holding, markerStr, barStr] = state.split('|');
  const now = new Set(nowIds ? nowIds.split(',') : []);
  const markerAt = Number(markerStr);
  const bar = Number(barStr);
  const focus = now.size ? nowIds : `${holding}|${markerAt}`;

  useEffect(() => {
    listRef.current?.querySelector('.now, .holding, .playhead-marker')?.scrollIntoView?.({ block: 'nearest' });
  }, [focus]);

  if (!gestures.length) return null;
  const marker = (
    <li key="playhead" className="playhead-marker">
      playhead{bar >= 0 ? `, m. ${index.measures[bar]?.label}` : ''}
    </li>
  );
  return (
    <section className="card list">
      <div className="list-head">
        <h3>In this performance</h3>
        <button
          className="danger small"
          title={`Remove every breath and tempo change (${MOD}Z undoes it)`}
          onClick={() => {
            const n = gestures.length;
            if (confirm(`Remove all ${n} breaths and tempo changes? ${MOD}Z undoes it.`)) onClearAll();
          }}
        >
          Clear all
        </button>
      </div>
      <div className="list-groups">
        <GroupToggle label="Breaths" title="Every breath on or off" gestures={sorted.map(({ g }) => g).filter((g) => g.type === 'breath')} onSetEnabled={onSetEnabled} />
        <GroupToggle label="Tempo changes" title="Every tempo change on or off" gestures={sorted.map(({ g }) => g).filter((g) => g.type !== 'breath')} onSetEnabled={onSetEnabled} />
      </div>
      <ul ref={listRef}>
        {sorted.flatMap(({ g }, i) => {
          const state = now.has(g.id) ? ' now' : g.id === holding ? ' holding' : '';
          const item = (
            <li key={g.id} className="gesture-row">
              <button className={`${g.id === gesture?.id ? 'active' : ''}${g.enabled === false ? ' off' : ''}${state}`} onClick={() => onSelect(g.id)}>
                <span className={`swatch ${swatch(g, rampInfo)}`} />
                <span className="row-text">
                  <span className="row-title">{gestureTitle(g, rampInfo)}</span>
                  <span className="row-where">{g.type === 'breath' ? `after ${anchorLabel(g.at)}` : shortRange(g.from, g.to)}</span>
                </span>
                {state && <span className={`tag${state}`}>{state === ' now' ? 'now' : 'holding'}</span>}
              </button>
              <Switch
                checked={g.enabled !== false}
                onChange={(on) => onSetEnabled([g.id], on)}
                title="On / off: hear the piece without it, keeping its settings"
                ariaLabel={`${gestureTitle(g, rampInfo)} on`}
              />
            </li>
          );
          return i === markerAt ? [marker, item] : [item];
        })}
        {markerAt === sorted.length && marker}
      </ul>
    </section>
  );
}

/** A switch for every gesture of a kind: on when all are, half on when only some are. */
function GroupToggle({ label, title, gestures, onSetEnabled }: { label: string; title: string; gestures: Gesture[]; onSetEnabled: (ids: string[], on: boolean) => void }) {
  const on = gestures.filter((g) => g.enabled !== false).length;
  const some = on > 0 && on < gestures.length;
  if (!gestures.length) return null;
  return (
    <Switch
      label={
        <>
          {label}
          <span className="muted"> {some ? `${on} of ${gestures.length} on` : gestures.length}</span>
        </>
      }
      title={title}
      checked={on === gestures.length}
      indeterminate={some}
      onChange={() => onSetEnabled(gestures.map((g) => g.id), on < gestures.length)}
    />
  );
}

export function anchorLabel(a: Anchor): string {
  const beat = Math.round((a.offsetQ + 1) * 100) / 100;
  return `m. ${a.label ?? a.measureIndex + 1}, ♩${beat}`;
}

/** "m. 4–7", or "m. 4, ♩1–2.5" within a bar: the list's short form (the editor shows the beats). */
function shortRange(from: Anchor, to: Anchor): string {
  const bar = (a: Anchor) => a.label ?? String(a.measureIndex + 1);
  const beat = (a: Anchor) => Math.round((a.offsetQ + 1) * 100) / 100;
  return from.measureIndex === to.measureIndex ? `m. ${bar(from)}, ♩${beat(from)}–${beat(to)}` : `m. ${bar(from)}–${bar(to)}`;
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
