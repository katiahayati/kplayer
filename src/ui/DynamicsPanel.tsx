import { useRef } from 'react';
import type { DynamicsDoc, NoteSelector, PulseRule, VoiceRule } from '../perf/types';
import { anchorLabel } from './Inspector';

interface Props {
  dynamics?: DynamicsDoc;
  /** Part names by index, for describing voices. */
  partNames: string[];
  /** Whether dynamics are playing at all (the Dynamics switch). */
  on: boolean;
  /** The voice whose notes are lit up in the score. */
  focus?: string;
  /** The selected note: which voice it's in and the velocity it plays at. */
  note?: { voice?: string; velocity: number };
  onChange: (d: DynamicsDoc, key: string) => void;
  onFocus: (id?: string) => void;
  onImport: (file: File) => void;
}

/** The voicing: strands of the texture, each with its own level against the written dynamics. */
export function DynamicsPanel(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const d = p.dynamics;
  const voices = d?.voices ?? [];
  const pulses = d?.pulse ?? [];
  const set = (id: string, patch: Partial<VoiceRule>, field: string) =>
    p.onChange({ ...d!, voices: voices.map((v) => (v.id === id ? { ...v, ...patch } : v)) }, `voice:${id}:${field}`);
  const setPulse = (id: string, patch: Partial<PulseRule>, field: string) =>
    p.onChange({ ...d!, pulse: pulses.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, `pulse:${id}:${field}`);
  const noteVoice = p.note?.voice ? voices.find((v) => v.id === p.note!.voice) : undefined;

  return (
    <section className="panel dynamics">
      <div className="list-head">
        <h3>Dynamics{p.on ? '' : ' (off)'}</h3>
        <button className="small" onClick={() => input.current?.click()} title="Take the voicing from a performance file, keeping your tempo phrasing">
          Import voicing…
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImport(f);
            e.target.value = '';
          }}
        />
      </div>
      {p.note && (
        <p className="muted">
          Selected note: {noteVoice ? noteVoice.name : 'no voice'}, velocity {Math.round(p.note.velocity * 127)}
        </p>
      )}
      {!voices.length ? (
        <p className="muted">The score's written dynamics play. A voicing brings some notes forward and keeps others back.</p>
      ) : (
        <ul className="voices">
          {voices.map((v) => (
            <li key={v.id} className={`${v.enabled === false ? 'off' : ''}${p.focus === v.id ? ' focus' : ''}`}>
              <div className="voice-head">
                <input
                  type="checkbox"
                  checked={v.enabled !== false}
                  onChange={(e) => set(v.id, { enabled: e.target.checked }, 'enabled')}
                  title="On / off"
                />
                <button className="voice-name" onClick={() => p.onFocus(p.focus === v.id ? undefined : v.id)} title="Show its notes in the score">
                  {v.name}
                </button>
                <label className="check" title="Sound slightly ahead, as a pianist brings out a melody">
                  <input type="checkbox" checked={!!v.lead} onChange={(e) => set(v.id, { lead: e.target.checked }, 'lead')} />
                  ahead
                </label>
              </div>
              <div className="muted voice-what">{describe(v, p.partNames)}</div>
              <label className="slider">
                <span>Level</span>
                <input type="range" min={-24} max={12} step={1} value={v.gainDb} onChange={(e) => set(v.id, { gainDb: Number(e.target.value) }, 'gain')} />
                <output>
                  {v.gainDb > 0 ? '+' : ''}
                  {v.gainDb} dB
                </output>
              </label>
            </li>
          ))}
        </ul>
      )}
      {pulses.length > 0 && (
        <>
          <h4>Pulse</h4>
          <ul className="voices">
            {pulses.map((r) => (
              <li key={r.id} className={r.enabled === false ? 'off' : ''}>
                <div className="voice-head">
                  <input type="checkbox" checked={r.enabled !== false} onChange={(e) => setPulse(r.id, { enabled: e.target.checked }, 'enabled')} title="On / off" />
                  <span className="voice-name">{r.name ?? 'Pulse'}</span>
                </div>
                <div className="muted voice-what">{describePulse(r, p.partNames)}</div>
                <label className="slider">
                  <span>Accent</span>
                  <input type="range" min={-6} max={9} step={0.5} value={r.gainDb} onChange={(e) => setPulse(r.id, { gainDb: Number(e.target.value) }, 'gain')} />
                  <output>
                    {r.gainDb > 0 ? '+' : ''}
                    {r.gainDb} dB
                  </output>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {(d?.pedal ?? []).map((span) => (
        <label key={span.id} className="check pedal" title="Sustain pedal over this stretch">
          <input
            type="checkbox"
            checked={span.enabled !== false}
            onChange={(e) => p.onChange({ ...d!, pedal: d!.pedal!.map((s) => (s.id === span.id ? { ...s, enabled: e.target.checked } : s)) }, `pedal:${span.id}`)}
          />
          Pedal, {PEDAL_MODES[span.mode]}, {anchorLabel(span.from)} – {anchorLabel(span.to)}
        </label>
      ))}
      {voices.some((v) => v.lead) && (
        <label className="slider">
          <span>Ahead by</span>
          <input type="range" min={0} max={50} step={5} value={d?.leadMs ?? 20} onChange={(e) => p.onChange({ ...d!, leadMs: Number(e.target.value) }, 'leadMs')} />
          <output>{d?.leadMs ?? 20} ms</output>
        </label>
      )}
    </section>
  );
}

const PEDAL_MODES = { harmony: 'changed with the harmony', beat: 'changed every beat', bar: 'changed every bar', off: 'off' } as const;

/** "On beats 1 and 4: Piano, lower staff, bottom note; fading over half the beat" */
function describePulse(r: PulseRule, partNames: string[]): string {
  const beats = r.beats ? `On beat ${r.beats.map((b) => +(b * r.every + 1).toFixed(2)).join(' and ')}` : `On every ${lengthName(r.every).replace(/^an? /, '')} beat`;
  const fade = r.fade ? `; fading over ${r.fade >= 1 ? 'the whole' : `${Math.round(r.fade * 100)}% of the`} beat` : '';
  return `${beats}: ${describe({ select: r.select ?? {}, from: r.from, to: r.to }, partNames)}${fade}`;
}

/** "Piano, upper staff, long notes, top note, m. 9 – m. 28" */
function describe(v: Pick<VoiceRule, 'select' | 'from' | 'to'>, partNames: string[]): string {
  const s: NoteSelector = v.select;
  const bits: string[] = [];
  if (s.part !== undefined) bits.push(partNames[s.part] ?? `part ${s.part + 1}`);
  if (s.staff) bits.push(s.staff.map((n) => (n === 1 ? 'upper staff' : n === 2 ? 'lower staff' : `staff ${n}`)).join(' + '));
  if (s.layer) bits.push(`voice ${s.layer.join(', ')}`);
  if (s.tremolo === true) bits.push('tremolos');
  if (s.tremolo === false) bits.push('no tremolos');
  if (s.minLength !== undefined) bits.push(`notes of ${lengthName(s.minLength)} or longer`);
  if (s.maxLength !== undefined) bits.push(`notes of ${lengthName(s.maxLength)} or shorter`);
  if (s.repeated === true) bits.push('repeated notes');
  if (s.repeated === false) bits.push('moving notes');
  if (s.top) bits.push('top note');
  if (s.bottom) bits.push('bottom note');
  if (v.from || v.to) bits.push(`${v.from ? anchorLabel(v.from) : 'start'} – ${v.to ? anchorLabel(v.to) : 'end'}`);
  return bits.join(', ') || 'every note';
}

function lengthName(q: number): string {
  const names: [number, string][] = [
    [6, 'a dotted whole note'],
    [4, 'a whole note'],
    [3, 'a dotted half'],
    [2, 'a half note'],
    [1.5, 'a dotted quarter'],
    [1, 'a quarter'],
    [0.5, 'an eighth'],
    [0.25, 'a 16th'],
    [0.125, 'a 32nd'],
  ];
  return names.find(([v]) => Math.abs(v - q) < 0.15)?.[1] ?? `${q} quarters`;
}
