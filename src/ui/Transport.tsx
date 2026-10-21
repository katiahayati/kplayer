import { useRef } from 'react';
import type { ScorePart } from '../perf/render';
import type { PartSetting } from '../perf/types';

interface Props {
  title?: string;
  playing: boolean;
  canPlay: boolean;
  position: string;
  /** Current tempo at the playhead, and how far your phrasing moves it from the written tempo. */
  bpm?: number;
  bpmChange?: number;
  status?: string;
  expressive: boolean;
  dynamics: boolean;
  /** The concert hall: on or off, and how much (1 is the usual amount). */
  hall: { on: boolean; level: number };
  tempoFactor: number;
  parts: ScorePart[];
  partSettings: Record<string, PartSetting>;
  loopLabel?: string;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: (file: File) => void;
  onImport: (file: File) => void;
  onExportJson: () => void;
  onExportMidi: () => void;
  onPlayPause: () => void;
  onRewind: () => void;
  onExpressive: (on: boolean) => void;
  onDynamics: (on: boolean) => void;
  onHall: (h: { on: boolean; level: number }) => void;
  onTempoFactor: (f: number) => void;
  onPart: (index: number, s: PartSetting) => void;
  onStopLoop: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Transport(p: Props) {
  const openRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  return (
    <header className="transport">
      <div className="row">
        <strong className="brand">kplayer</strong>
        <button onClick={() => openRef.current?.click()}>Open score…</button>
        <input ref={openRef} type="file" accept=".musicxml,.xml,.mxl" hidden onChange={(e) => pickFile(e, p.onOpen)} />
        {p.title && <span className="title">{p.title}</span>}
        <span className="spacer" />
        {p.canPlay && (
          <>
            <button onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            <button onClick={() => importRef.current?.click()}>Import…</button>
            <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => pickFile(e, p.onImport)} />
            <button onClick={p.onExportJson} title="Save the performance as a sidecar JSON file">
              Export JSON
            </button>
            <button onClick={p.onExportMidi} title="Export the expressively timed MIDI">
              Export MIDI
            </button>
          </>
        )}
      </div>
      {p.canPlay && (
        <div className="row">
          <button onClick={p.onRewind} title="Back to the beginning (Home)" aria-label="Back to the beginning">
            ⏮
          </button>
          <button className="play" onClick={p.onPlayPause} title="Play / pause (Space)">
            {p.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          {p.bpm !== undefined && (
            <span className="bpm" title="Tempo at the playhead">
              ♩ = {Math.round(p.bpm)}
              {!!p.bpmChange && (
                <span className="muted">
                  {' '}
                  ({p.bpmChange > 0 ? '+' : ''}
                  {p.bpmChange}%)
                </span>
              )}
            </span>
          )}
          <span className="position">{p.position}</span>
          {p.loopLabel && (
            <span className="pill loop">
              ⟲ {p.loopLabel}
              <button onClick={p.onStopLoop} title="Stop looping">
                ×
              </button>
            </span>
          )}
          {p.status && <span className="status">{p.status}</span>}
          <span className="spacer" />
          <label className="toggle" title="Compare with and without your phrasing (E)">
            <input type="checkbox" checked={p.expressive} onChange={(e) => p.onExpressive(e.target.checked)} />
            Expressive
          </label>
          <label className="toggle" title="Compare with and without dynamics: written ones and your voicing (D)">
            <input type="checkbox" checked={p.dynamics} onChange={(e) => p.onDynamics(e.target.checked)} />
            Dynamics
          </label>
          <span className="hall">
            <label className="toggle" title="Play in a concert hall, or dry as if close-miked (H)">
              <input type="checkbox" checked={p.hall.on} onChange={(e) => p.onHall({ ...p.hall, on: e.target.checked })} />
              Hall
            </label>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(p.hall.level * 100)}
              disabled={!p.hall.on}
              title={`How much hall: ${Math.round(p.hall.level * 100)}%`}
              aria-label="How much hall"
              onChange={(e) => p.onHall({ ...p.hall, level: Number(e.target.value) / 100 })}
            />
          </span>
          <label className="tempo">
            Tempo
            <input type="range" min={50} max={150} step={1} value={Math.round(p.tempoFactor * 100)} onChange={(e) => p.onTempoFactor(Number(e.target.value) / 100)} />
            <output>{Math.round(p.tempoFactor * 100)}%</output>
          </label>
          {p.parts.map((part) => {
            const s = p.partSettings[part.index] ?? { mute: false, volume: 1 };
            return (
              <span key={part.index} className={`part${s.mute ? ' muted' : ''}`}>
                <button onClick={() => p.onPart(part.index, { ...s, mute: !s.mute })} title={s.mute ? 'Unmute' : 'Mute'}>
                  {s.mute ? '🔇' : '🔊'} {part.name}
                </button>
                <input type="range" min={0} max={100} value={Math.round(s.volume * 100)} onChange={(e) => p.onPart(part.index, { ...s, volume: Number(e.target.value) / 100 })} />
              </span>
            );
          })}
        </div>
      )}
    </header>
  );
}

function pickFile(e: React.ChangeEvent<HTMLInputElement>, cb: (f: File) => void) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) cb(f);
}
