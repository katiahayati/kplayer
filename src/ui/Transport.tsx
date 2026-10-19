import { useRef } from 'react';
import type { ScorePart } from '../perf/render';
import type { PartSetting } from '../perf/types';

interface Props {
  title?: string;
  playing: boolean;
  canPlay: boolean;
  position: string;
  status?: string;
  expressive: boolean;
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
  onExpressive: (on: boolean) => void;
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
          <button className="play" onClick={p.onPlayPause} title="Play / pause (Space)">
            {p.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
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
