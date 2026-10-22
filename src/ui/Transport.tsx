// The top bar (the piece, undo, the File menu) and the player bar above the
// tempo lane (play, where you are, and how it sounds).

import { useRef } from 'react';
import { FileDown, FileJson, FolderOpen, Pause, Play, Redo2, Repeat, Save, SkipBack, SlidersHorizontal, Undo2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { ScorePart } from '../perf/render';
import type { PartSetting } from '../perf/types';
import { OPEN_ACCEPT } from '../storage/piece';
import { Popover, Switch } from './controls';
import { usePlayhead, type Playhead } from './playhead';

interface TopBarProps {
  title?: string;
  /** A score is open. */
  open: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: (file: File) => void;
  onImport: (file: File) => void;
  onSavePiece: () => void;
  onExportJson: () => void;
  onExportMidi: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopBar(p: TopBarProps) {
  const openRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const item = (close: () => void, run: () => void) => () => {
    close();
    run();
  };
  return (
    <header className="topbar">
      <span className="brand">
        <span className="logo" aria-hidden>
          k
        </span>
        kplayer
      </span>
      {p.title && <span className="piece-title">{p.title}</span>}
      <span className="spacer" />
      <input ref={openRef} type="file" accept={OPEN_ACCEPT} hidden onChange={(e) => pickFile(e, p.onOpen)} />
      <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => pickFile(e, p.onImport)} />
      {p.open ? (
        <>
          <button className="icon" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 size={18} />
          </button>
          <button className="icon" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Redo2 size={18} />
          </button>
          <Popover className="file-menu" align="right" ariaLabel="File menu" button={<>File</>}>
            {(close) => (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={item(close, () => openRef.current?.click())}>
                  <FolderOpen size={16} /> Open…
                </button>
                <button
                  role="menuitem"
                  onClick={item(close, p.onSavePiece)}
                  title="One .kplayer file with the score and your phrasing and dynamics: open it to get everything back"
                >
                  <Save size={16} /> Save piece… <kbd>Ctrl S</kbd>
                </button>
                <hr />
                <button role="menuitem" onClick={item(close, () => importRef.current?.click())} title="Phrasing and dynamics from a JSON file, for the open score">
                  <Upload size={16} /> Import…
                </button>
                <button role="menuitem" onClick={item(close, p.onExportJson)} title="Your phrasing and dynamics as a JSON file, without the score">
                  <FileJson size={16} /> Export JSON
                </button>
                <button role="menuitem" onClick={item(close, p.onExportMidi)} title="The performance as a MIDI file, with its timing and dynamics">
                  <FileDown size={16} /> Export MIDI
                </button>
              </div>
            )}
          </Popover>
        </>
      ) : (
        <button onClick={() => openRef.current?.click()} title="Open a score (MusicXML) or a kplayer piece">
          <FolderOpen size={16} /> Open…
        </button>
      )}
    </header>
  );
}

interface PlayerBarProps {
  /** A phone: the sound settings fold into one menu. */
  compact?: boolean;
  playing: boolean;
  playhead: Playhead;
  /** "m. 12 · 0:42.1 / 2:06.8" at a score position. */
  positionAt: (q: number) => string;
  /** The tempo at a score position and how far your phrasing moves it from the written tempo: "112|-15". */
  tempoAt: (q: number) => string;
  status?: string;
  expressive: boolean;
  dynamics: boolean;
  /** The concert hall: on or off, and how much (1 is the usual amount). */
  hall: { on: boolean; level: number };
  tempoFactor: number;
  parts: ScorePart[];
  partSettings: Record<string, PartSetting>;
  loopLabel?: string;
  onPlayPause: () => void;
  onRewind: () => void;
  onExpressive: (on: boolean) => void;
  onDynamics: (on: boolean) => void;
  onHall: (h: { on: boolean; level: number }) => void;
  onTempoFactor: (f: number) => void;
  onPart: (index: number, s: PartSetting) => void;
  onStopLoop: () => void;
}

export function PlayerBar(p: PlayerBarProps) {
  const muted = p.parts.filter((part) => p.partSettings[part.index]?.mute).length;
  const listen = (
    <div className="listen">
      <Switch label="Phrasing" checked={p.expressive} onChange={p.onExpressive} title="Hear it with or without your breaths and tempo changes (E)" />
      <Switch label="Dynamics" checked={p.dynamics} onChange={p.onDynamics} title="Hear it with or without dynamics: the score's and your voicing (D)" />
    </div>
  );
  const tempo = (
    <label className="tempo" title="Speed of the whole piece, against the written tempo">
      <span>Tempo</span>
      <input type="range" min={50} max={150} step={1} value={Math.round(p.tempoFactor * 100)} onChange={(e) => p.onTempoFactor(Number(e.target.value) / 100)} />
      <output>{Math.round(p.tempoFactor * 100)}%</output>
    </label>
  );
  const hall = (
    <span className="hall">
      <Switch label="Hall" checked={p.hall.on} onChange={(on) => p.onHall({ ...p.hall, on })} title="Play in a concert hall, or dry as if close-miked (H)" />
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
  );
  const mixer = (
    <div className="mixer-panel">
      {p.parts.map((part) => {
        const s = p.partSettings[part.index] ?? { mute: false, volume: 1 };
        return (
          <div key={part.index} className={`part${s.mute ? ' muted' : ''}`}>
            <button
              className="icon"
              onClick={() => p.onPart(part.index, { ...s, mute: !s.mute })}
              title={s.mute ? 'Unmute' : 'Mute'}
              aria-label={`${s.mute ? 'Unmute' : 'Mute'} ${part.name}`}
            >
              {s.mute ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <span className="name">{part.name}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.volume * 100)}
              aria-label={`${part.name} volume`}
              onChange={(e) => p.onPart(part.index, { ...s, volume: Number(e.target.value) / 100 })}
            />
            <output>{Math.round(s.volume * 100)}%</output>
          </div>
        );
      })}
    </div>
  );
  return (
    <div className={`playerbar${p.compact ? ' compact' : ''}`}>
      <div className="transport-buttons">
        <button className="icon" onClick={p.onRewind} title="Back to the beginning (Home)" aria-label="Back to the beginning">
          <SkipBack size={18} />
        </button>
        <button className="play" onClick={p.onPlayPause} title="Play / pause (Space)">
          {p.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          <span>{p.playing ? 'Pause' : 'Play'}</span>
        </button>
      </div>
      <Position playhead={p.playhead} positionAt={p.positionAt} />
      <Tempo playhead={p.playhead} tempoAt={p.tempoAt} />
      {p.loopLabel && (
        <span className="pill loop">
          <Repeat size={14} /> {p.loopLabel}
          <button onClick={p.onStopLoop} title="Stop looping (L)" aria-label="Stop looping">
            <X size={14} />
          </button>
        </span>
      )}
      {p.status && <span className="status">{p.status}</span>}
      <span className="spacer" />
      {p.compact ? (
        <Popover className="sound-menu" align="right" up title="Phrasing, dynamics, tempo, hall and each part's volume" ariaLabel="Sound settings" button={<SlidersHorizontal size={18} />}>
          {() => (
            <div className="sound-panel">
              {listen}
              {tempo}
              {hall}
              {mixer}
            </div>
          )}
        </Popover>
      ) : (
        <>
          {listen}
          {tempo}
          {hall}
          <Popover
            className="mixer"
            align="right"
            up
            title="Each part's volume, and muting"
            button={
              <>
                <SlidersHorizontal size={16} /> Mixer{muted ? <span className="badge">{muted} muted</span> : null}
              </>
            }
          >
            {() => mixer}
          </Popover>
        </>
      )}
    </div>
  );
}

/** Bar and time at the playhead: redrawn as they change (ten times a second while playing), not every frame. */
function Position({ playhead, positionAt }: { playhead: Playhead; positionAt: (q: number) => string }) {
  const [bar, time] = usePlayhead(playhead, positionAt).split(' · ');
  return (
    <span className="position" title="Where the playhead is: bar, and time">
      <strong>{bar}</strong>
      {time && <span className="sep"> · </span>}
      {time && <span className="time">{time}</span>}
    </span>
  );
}

/** The tempo at the playhead, and how far your phrasing moves it from the written tempo. */
function Tempo({ playhead, tempoAt }: { playhead: Playhead; tempoAt: (q: number) => string }) {
  const value = usePlayhead(playhead, tempoAt);
  if (!value) return null;
  const [bpm, change] = value.split('|').map(Number);
  return (
    <span className="bpm" title="Tempo at the playhead, and how far your phrasing moves it from the written tempo">
      ♩ = {bpm}
      {!!change && (
        <span className={`change ${change < 0 ? 'slower' : 'faster'}`}>
          {change > 0 ? '+' : '−'}
          {Math.abs(change)}%
        </span>
      )}
    </span>
  );
}

function pickFile(e: React.ChangeEvent<HTMLInputElement>, cb: (f: File) => void) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) cb(f);
}
