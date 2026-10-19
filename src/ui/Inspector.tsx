import type { ScoreIndex } from '../perf/anchors';
import { BREATH_PRESETS, type BreathPresetKey } from '../perf/presets';
import type { BreathResult } from '../perf/timeline';
import type { Anchor, BreathGesture, Gesture, RampGesture, ShapeGesture } from '../perf/types';

export type SectionKind = 'slower' | 'faster' | 'broaden' | 'push' | 'aTempo';

interface Props {
  index: ScoreIndex;
  /** What's selected in the score, when it isn't a gesture. */
  noteSelection?: { from: Anchor; to: Anchor; single: boolean };
  gesture?: Gesture;
  gestures: Gesture[];
  breathResults: BreathResult[];
  /** Written breath marks in the score that aren't breaths yet. */
  unusedBreathMarks: number;
  loopOn: boolean;
  onImportBreathMarks: () => void;
  onAddBreath: () => void;
  onAddSection: (kind: SectionKind) => void;
  onChange: (id: string, patch: Partial<Gesture>, key: string) => void;
  onDelete: (id: string) => void;
  onToggleLoop: () => void;
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

function GestureEditor({ gesture: g, breathResults, loopOn, onChange, onDelete, onToggleLoop }: Props & { gesture: Gesture }) {
  const set = (patch: Partial<Gesture>, field: string) => onChange(g.id, patch, `${g.id}:${field}`);
  return (
    <section className="panel">
      <h2>{gestureTitle(g)}</h2>
      <p className="muted">{g.type === 'breath' ? `After ${anchorLabel(g.at)}` : `${anchorLabel(g.from)} → ${anchorLabel(g.to)}`}</p>

      {g.type === 'breath' && <BreathFields g={g} result={breathResults.find((r) => r.id === g.id)} set={set} />}
      {g.type === 'ramp' && <RampFields g={g} set={set} />}
      {g.type === 'shape' && <ShapeFields g={g} set={set} />}
      {g.type === 'aTempo' && <p className="muted">Eases back to the written tempo over this section.</p>}

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
      <p className="muted">Only the note before the breath is held longer; the next note comes in on tempo.</p>
      {result && (
        <p className={result.clamped ? 'warn' : 'muted'}>
          {result.clamped
            ? `Capped at ${Math.round(result.addedSec * 1000)} ms: that note can stretch to at most 4× its length.`
            : `That note is held ${Math.round(result.addedSec * 1000)} ms longer (${Math.round(result.minRatio * 100)}% tempo while it sounds).`}
        </p>
      )}
    </>
  );
}

function RampFields({ g, set }: { g: RampGesture; set: Setter }) {
  return (
    <>
      <div className="presets">
        <button className={g.dir === 'slower' ? 'active' : ''} onClick={() => set({ dir: 'slower' }, 'dir')}>
          Slower
        </button>
        <button className={g.dir === 'faster' ? 'active' : ''} onClick={() => set({ dir: 'faster' }, 'dir')}>
          Faster
        </button>
      </div>
      <Slider label="Amount" value={Math.round(g.amount * 100)} min={1} max={g.dir === 'slower' ? 60 : 100} step={1} unit="%" onChange={(v) => set({ amount: v / 100 }, 'amount')} />
      <p className="muted">Holds the new tempo afterwards, until an a tempo.</p>
    </>
  );
}

function ShapeFields({ g, set }: { g: ShapeGesture; set: Setter }) {
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
      <Slider label="Peak" value={Math.round(g.peak * 100)} min={20} max={100} step={5} unit="%" onChange={(v) => set({ peak: v / 100 }, 'peak')} />
      <Slider label="Settle after" value={g.releaseQ} min={0} max={4} step={0.25} unit=" ♩" onChange={(v) => set({ releaseQ: v }, 'releaseQ')} />
      <p className="muted">Returns to the surrounding tempo by the end{g.releaseQ ? ', plus the settle time' : ''}.</p>
    </>
  );
}

function GestureList({ gestures, gesture, onSelect }: Props) {
  if (!gestures.length) return null;
  const sorted = [...gestures].sort((a, b) => order(a) - order(b));
  return (
    <section className="panel list">
      <h3>In this performance</h3>
      <ul>
        {sorted.map((g) => (
          <li key={g.id}>
            <button className={`${g.id === gesture?.id ? 'active' : ''}${g.enabled === false ? ' off' : ''}`} onClick={() => onSelect(g.id)}>
              <span className={`swatch ${swatch(g)}`} />
              {gestureTitle(g)} <span className="muted">{anchorLabel(g.type === 'breath' ? g.at : g.from)}</span>
            </button>
          </li>
        ))}
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

function gestureTitle(g: Gesture): string {
  switch (g.type) {
    case 'breath':
      return `Breath · ${g.extraMs} ms`;
    case 'ramp':
      return `${g.dir === 'slower' ? 'Slow down' : 'Speed up'} · ${Math.round(g.amount * 100)}%`;
    case 'shape':
      return `${g.gesture === 'broaden' ? 'Broaden' : 'Push forward'} · ${Math.round(g.amount * 100)}%`;
    case 'aTempo':
      return 'A tempo';
  }
}

function swatch(g: Gesture): string {
  if (g.type === 'ramp') return g.dir;
  if (g.type === 'shape') return g.gesture;
  return g.type;
}

function order(g: Gesture): number {
  const a = g.type === 'breath' ? g.at : g.from;
  return a.measureIndex * 1000 + a.offsetQ;
}
