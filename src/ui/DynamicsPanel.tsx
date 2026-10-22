import { useRef } from 'react';
import { Upload } from 'lucide-react';
import type { DynamicsDoc, NoteSelector, PulseRule, VoiceRule } from '../perf/types';
import { MOD, Slider, Switch } from './controls';
import { anchorLabel } from './Inspector';

interface Props {
  dynamics?: DynamicsDoc;
  /** Part names by index, for describing voices. */
  partNames: string[];
  /** Whether dynamics are playing at all (the Dynamics switch). */
  on: boolean;
  /** The whole piece louder or softer, in dB. */
  volumeDb: number;
  onVolume: (db: number) => void;
  /** The voice whose notes are lit up in the score. */
  focus?: string;
  /** The selected note: which voice it's in and the velocity it plays at. */
  note?: { voice?: string; velocity: number };
  onChange: (d: DynamicsDoc, key: string) => void;
  onFocus: (id?: string) => void;
  onImport: (file: File) => void;
  /** Removes the voicing (undoable), so the score's written dynamics play. */
  onClear: () => void;
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
  // What clearing would remove, for asking first.
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
  const contents = [
    voices.length && count(voices.length, 'voice'),
    pulses.length && count(pulses.length, 'pulse'),
    d?.pedal?.length && 'the pedal',
    (d?.marks?.length || d?.hairpins?.length) && 'its own dynamics',
  ].filter(Boolean);

  const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} dB`;
  return (
    <>
      <section className="card volume">
        <h3>Volume</h3>
        <Slider label="Whole piece" value={p.volumeDb} min={-12} max={18} step={1} unit=" dB" format={db} onChange={p.onVolume} />
        <p className="note">Turns the whole piece up or down, without changing how it's played. Saved with the piece.</p>
      </section>
      <section className="card dynamics">
        <div className="list-head">
          <h3>Voicing{p.on ? '' : ' (dynamics off)'}</h3>
          <span className="actions">
            <button className="small" onClick={() => input.current?.click()} title="Take the voicing from a performance or voicing file, keeping your phrasing">
              <Upload size={14} /> {voices.length ? 'Import voicing…' : 'Import a kespressivo voicing…'}
            </button>
            {contents.length > 0 && (
              <button
                className="danger small"
                title={`Remove the voicing, so the score's written dynamics play (${MOD}Z undoes it)`}
                onClick={() => {
                  if (confirm(`Remove the voicing (${contents.join(', ')})? The score's written dynamics play again. ${MOD}Z undoes it.`)) p.onClear();
                }}
              >
                Clear voicing
              </button>
            )}
          </span>
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
          <p className="selected-note">
            Selected note: {noteVoice ? noteVoice.name : 'no voice'}, velocity {Math.round(p.note.velocity * 127)}
          </p>
        )}
        {!voices.length ? (
          <p className="note">
            The score's written dynamics play. A voicing brings some notes forward and keeps others back:{' '}
            <a href={KESPRESSIVO_URL} target="_blank" rel="noreferrer">
              kespressivo
            </a>{' '}
            writes one from the score, and can learn a recording's dynamics.
          </p>
        ) : (
          <ul className="voices">
            {voices.map((v) => (
              <li key={v.id} className={`${v.enabled === false ? 'off' : ''}${p.focus === v.id ? ' focus' : ''}`}>
                <div className="voice-head">
                  <Switch checked={v.enabled !== false} onChange={(on) => set(v.id, { enabled: on }, 'enabled')} title="On / off" ariaLabel={`${v.name} on`} />
                  <button className="voice-name" onClick={() => p.onFocus(p.focus === v.id ? undefined : v.id)} title="Show its notes in the score">
                    {v.name}
                  </button>
                  <label className="chip-toggle" title="Sound slightly ahead, as a pianist brings out a melody">
                    <input type="checkbox" checked={!!v.lead} onChange={(e) => set(v.id, { lead: e.target.checked }, 'lead')} />
                    ahead
                  </label>
                </div>
                <div className="voice-what">{describe(v, p.partNames)}</div>
                <Slider label="Level" value={v.gainDb} min={-24} max={12} step={1} unit=" dB" format={db} onChange={(x) => set(v.id, { gainDb: x }, 'gain')} />
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
                    <Switch checked={r.enabled !== false} onChange={(on) => setPulse(r.id, { enabled: on }, 'enabled')} title="On / off" ariaLabel={`${r.name ?? 'Pulse'} on`} />
                    <span className="voice-name">{r.name ?? 'Pulse'}</span>
                  </div>
                  <div className="voice-what">{describePulse(r, p.partNames)}</div>
                  <Slider label="Accent" value={r.gainDb} min={-6} max={9} step={0.5} unit=" dB" format={db} onChange={(x) => setPulse(r.id, { gainDb: x }, 'gain')} />
                </li>
              ))}
            </ul>
          </>
        )}
        {(d?.pedal ?? []).length > 0 && (
          <>
            <h4>Pedal</h4>
            <ul className="pedals">
              {(d?.pedal ?? []).map((span) => (
                <li key={span.id}>
                  <Switch
                    checked={span.enabled !== false}
                    title="Sustain pedal over this stretch"
                    ariaLabel="Pedal on"
                    onChange={(on) => p.onChange({ ...d!, pedal: d!.pedal!.map((s) => (s.id === span.id ? { ...s, enabled: on } : s)) }, `pedal:${span.id}`)}
                    label={
                      <span>
                        {PEDAL_MODES[span.mode]}
                        {span.every && span.every !== 1 && span.mode !== 'bar' && span.mode !== 'off' ? ` (by the ${lengthName(span.every).replace(/^an? /, '')})` : ''}
                        <span className="muted">
                          {' '}
                          · {anchorLabel(span.from)} – {anchorLabel(span.to)}
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {voices.some((v) => v.lead) && (
          <Slider label="Ahead by" value={d?.leadMs ?? 20} min={0} max={50} step={5} unit=" ms" onChange={(x) => p.onChange({ ...d!, leadMs: x }, 'leadMs')} />
        )}
      </section>
    </>
  );
}

/** kplayer's companion, which writes voicings and learns performances from recordings. */
const KESPRESSIVO_URL = 'https://github.com/katiahayati/kespressivo';

const PEDAL_MODES = { harmony: 'Changed with the harmony', beat: 'Changed every beat', bar: 'Changed every bar', off: 'Off' } as const;

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
