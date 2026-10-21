import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, unlockAudio, type SoundBankSource } from './audio/player';
import { anchorFor, breathWindow, loopAround, nearestSpan, playedMeasureAt, resolveAnchor } from './perf/anchors';
import { compileGestures } from './perf/compile';
import { shapeDynamics } from './perf/dynamics';
import { BREATH_PRESETS, DEFAULT_BREATH_PRESET, SECTION_DEFAULTS } from './perf/presets';
import { renderPerformanceMidi } from './perf/render';
import { buildTimeMap, sectionLevelAt, type TimeMap, type TimingGesture } from './perf/timeline';
import { emptyDoc, type Anchor, type Gesture, type PartSetting, type PerformanceDoc } from './perf/types';
import { ScoreView, type BreathMarker } from './score/ScoreView';
import { loadScore, type LoadedScore } from './score/verovio';
import { downloadBlob, loadSaved, parseDoc, save } from './storage/persist';
import { DynamicsPanel } from './ui/DynamicsPanel';
import { Inspector, type PickField, type RampInfo, type SectionKind } from './ui/Inspector';
import { formatTime, TempoLane } from './ui/TempoLane';
import { Transport } from './ui/Transport';
import { useHistory } from './ui/useHistory';

const SOUND_BANKS: SoundBankSource[] = [
  { id: 'piano', url: `${import.meta.env.BASE_URL}soundfonts/SalamanderGrandPiano.sf3`, optional: true },
  { id: 'general', url: `${import.meta.env.BASE_URL}soundfonts/MuseScore_General.sf3` },
];
const DEMO_URL = `${import.meta.env.BASE_URL}demo/song.musicxml`;

/** How much concert hall the piano plays in: a listening setting, remembered in this browser. */
interface HallSetting {
  on: boolean;
  /** 1 is the usual amount. */
  level: number;
}
const HALL_KEY = 'kplayer.hall';
function readHall(): HallSetting {
  try {
    const h = JSON.parse(localStorage.getItem(HALL_KEY) ?? 'null');
    if (typeof h?.on === 'boolean' && typeof h?.level === 'number') return h;
  } catch {
    // No storage (private window, blocked): the default.
  }
  return { on: true, level: 1 };
}

type Selection = { kind: 'none' } | { kind: 'notes'; anchorId: string; focusId: string } | { kind: 'gesture'; id: string };

export default function App() {
  const [score, setScore] = useState<LoadedScore>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  /** Progress of loading the sounds, which starts as soon as the page opens. */
  const [soundStatus, setSoundStatus] = useState<string>();
  const [hall, setHall] = useState(readHall);
  const hallRef = useRef(hall);
  hallRef.current = hall;
  const history = useHistory<PerformanceDoc>(emptyDoc());
  const doc = history.value;
  const [expressive, setExpressive] = useState(true);
  /** Play dynamics (written and your voicing), or every note at one level as Verovio gives them. */
  const [dynamicsOn, setDynamicsOn] = useState(true);
  /** The voice whose notes are lit up in the score. */
  const [focusVoice, setFocusVoice] = useState<string>();
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [loopGestureId, setLoopGestureId] = useState<string>();
  /** A shape waiting for a note click to set its peak or hold note. */
  const [picking, setPicking] = useState<{ gestureId: string; field: PickField }>();
  const [playQ, setPlayQ] = useState(0);
  const [playing, setPlaying] = useState(false);

  const player = useRef<Player | undefined>(undefined);
  const playerLoading = useRef<Promise<Player> | undefined>(undefined);
  /** The time map matching what's loaded in the player. */
  const loadedMap = useRef<TimeMap | undefined>(undefined);
  /** A position (and whether to play) for the next reload, set by seeks that change the loop. */
  const pendingQ = useRef<number | undefined>(undefined);
  const pendingPlay = useRef(false);
  const playQRef = useRef(0);
  playQRef.current = playQ;
  /** Where playing again starts once the piece has ended: the selected notes, else the beginning. */
  const restartQRef = useRef(0);

  // ---- Timing --------------------------------------------------------------

  const allTiming = useMemo(
    () =>
      score
        ? compileGestures(
            doc.gestures,
            (a) => resolveAnchor(score.index, a),
            (q, staff) => breathWindow(score.staffSpans, q, staff),
          )
        : [],
    [score, doc.gestures],
  );
  const timing = expressive ? allTiming : NO_TIMING;
  const map = useMemo(
    () =>
      score ? buildTimeMap({ tempos: score.events.tempos, endQ: score.index.endQ, gestures: timing, tempoFactor: doc.tempoFactor }) : undefined,
    [score, timing, doc.tempoFactor],
  );

  const loop = useMemo(() => {
    if (!score || !loopGestureId) return undefined;
    const spans = allTiming.filter((g) => g.id === loopGestureId).map(extent);
    if (!spans.length) return undefined;
    // First pass at or after the playhead, else the first.
    const s = spans.find(([, hi]) => hi >= playQRef.current) ?? spans[0];
    return loopAround(score.index, s[0], s[1]);
  }, [score, loopGestureId, allTiming]);

  const shaped = useMemo(
    () =>
      score && dynamicsOn
        ? shapeDynamics({
            events: score.events,
            marks: score.dynamics,
            hairpins: score.hairpins,
            doc: doc.dynamics,
            resolve: (a) => resolveAnchor(score.index, a),
            barStarts: score.index.played.map((m) => m.q0),
          })
        : score?.events,
    [score, dynamicsOn, doc.dynamics],
  );
  const midi = useMemo(
    () => (shaped && map ? renderPerformanceMidi(shaped, map, { parts: doc.parts, loop }) : undefined),
    [shaped, map, doc.parts, loop],
  );

  // ---- Player sync -----------------------------------------------------------

  const latest = useRef({ midi, map, loop });
  latest.current = { midi, map, loop };

  const pushToPlayer = useCallback((opts: { play?: boolean } = {}) => {
    const p = player.current;
    const { midi, map, loop } = latest.current;
    if (!p || !midi || !map) return;
    const prev = loadedMap.current;
    let q = pendingQ.current ?? (p.playing && prev ? prev.qAt(p.time) : playQRef.current);
    const play = opts.play ?? (pendingPlay.current || undefined);
    pendingQ.current = undefined;
    pendingPlay.current = false;
    if (loop && (q < loop.q0 || q >= loop.q1)) q = loop.q0;
    if (q >= map.endQ - 1e-6) q = restartQRef.current;
    p.load(midi, { offset: loop ? map.T(loop.q0) : 0, loop: !!loop, at: map.T(q), play });
    loadedMap.current = map;
    setPlayQ(q);
  }, []);

  useEffect(() => {
    if (!player.current || !midi) return;
    const t = setTimeout(() => pushToPlayer(), 120);
    return () => clearTimeout(t);
  }, [midi, pushToPlayer]);

  useEffect(() => {
    let raf = 0;
    let wasOn = false;
    const tick = () => {
      const p = player.current;
      const m = loadedMap.current;
      if (p && m) {
        const on = p.playing;
        setPlaying(on);
        if (on) setPlayQ(Math.min(m.qAt(p.time), m.endQ));
        else if (wasOn && p.finished) {
          // The end: back to the selected notes (or the beginning), ready to play again from there.
          setPlayQ(restartQRef.current);
          p.seek(m.T(restartQRef.current));
        }
        wasOn = on;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ensurePlayer = useCallback(async (): Promise<Player | undefined> => {
    if (player.current) return player.current;
    try {
      playerLoading.current ??= Player.create(SOUND_BANKS, setSoundStatus);
      const p = await playerLoading.current;
      if (!player.current) {
        player.current = p;
        const h = hallRef.current;
        p.setHall(h.on ? h.level : 0);
      }
      return player.current;
    } catch (e) {
      playerLoading.current = undefined;
      setError(`Couldn't start audio: ${(e as Error).message}. Did you run "npm run fetch-soundfont"?`);
    } finally {
      setSoundStatus(undefined);
    }
  }, []);

  // Load the sounds as soon as the page opens, and hand the player the piece (paused) as soon as both
  // are there, so the samples it needs are ready before Play. (No audio in tests: skip.)
  useEffect(() => {
    if (typeof AudioContext !== 'undefined') void ensurePlayer().then((p) => p && !loadedMap.current && pushToPlayer());
  }, [ensurePlayer, pushToPlayer]);

  useEffect(() => {
    try {
      localStorage.setItem(HALL_KEY, JSON.stringify(hall));
    } catch {
      // Not remembered, but still applied.
    }
    player.current?.setHall(hall.on ? hall.level : 0);
  }, [hall]);

  const togglePlay = useCallback(async () => {
    if (!score) return;
    // Browsers only let audio start from a click or key press: before anything is awaited.
    unlockAudio();
    const p = await ensurePlayer();
    if (!p) return;
    if (!loadedMap.current) return pushToPlayer({ play: true });
    if (p.playing) return p.pause();
    const m = loadedMap.current;
    if (m && (p.finished || playQRef.current >= m.endQ - 1e-6)) {
      // A finished sequencer needs reloading; from where the playhead is, unless it's still at the end.
      pendingQ.current = playQRef.current >= m.endQ - 1e-6 ? restartQRef.current : playQRef.current;
      return pushToPlayer({ play: true });
    }
    p.play();
  }, [score, ensurePlayer, pushToPlayer]);

  const seekTo = useCallback(
    (q: number, play = false) => {
      setPlayQ(q);
      const p = player.current;
      const m = loadedMap.current;
      if (loop && (q < loop.q0 || q >= loop.q1)) {
        // Leaving the loop: drop it; the reload starts from q.
        pendingQ.current = q;
        pendingPlay.current = play;
        setLoopGestureId(undefined);
        if (play && !p) void togglePlay();
        return;
      }
      if (p && m) {
        p.seek(m.T(q));
        if (play && !p.playing) p.play();
        return;
      }
      // No player yet (nothing has played): the first Play starts here.
      pendingQ.current = q;
      if (play) void togglePlay();
    },
    [loop, togglePlay],
  );

  // ---- Score & document ------------------------------------------------------

  const openFile = useCallback(
    async (file: File) => {
      setError(undefined);
      setStatus('Reading score…');
      try {
        const s = await loadScore(file);
        const saved = await loadSaved(s.sha256);
        player.current?.pause();
        history.reset(saved ?? { ...emptyDoc(), score: { name: s.name, sha256: s.sha256 } });
        setSelection({ kind: 'none' });
        setLoopGestureId(undefined);
        pendingQ.current = 0;
        loadedMap.current = undefined;
        setPlayQ(0);
        setScore(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setStatus(undefined);
      }
    },
    [history],
  );

  const openDemo = async () => {
    const res = await fetch(DEMO_URL);
    await openFile(new File([await res.blob()], 'demo.musicxml'));
  };

  useEffect(() => {
    if (!score) return;
    const t = setTimeout(() => void save(score.sha256, doc), 400);
    return () => clearTimeout(t);
  }, [doc, score]);

  const setDoc = history.set;
  const updateGesture = useCallback(
    (id: string, patch: Partial<Gesture>, key: string) =>
      setDoc({ ...doc, gestures: doc.gestures.map((g) => (g.id === id ? ({ ...g, ...patch } as Gesture) : g)) }, key),
    [doc, setDoc],
  );
  /** Switches gestures on or off without deleting them, to hear the piece with and without. */
  const setEnabled = useCallback(
    (ids: string[], on: boolean) => {
      const which = new Set(ids);
      setDoc({ ...doc, gestures: doc.gestures.map((g) => (which.has(g.id) ? { ...g, enabled: on } : g)) }, `enabled:${ids.join()}`);
    },
    [doc, setDoc],
  );
  const deleteGesture = useCallback(
    (id: string) => {
      setDoc({ ...doc, gestures: doc.gestures.filter((g) => g.id !== id) });
      setSelection({ kind: 'none' });
      if (loopGestureId === id) setLoopGestureId(undefined);
    },
    [doc, setDoc, loopGestureId],
  );
  const clearAll = useCallback(() => {
    setDoc({ ...doc, gestures: [] });
    setSelection({ kind: 'none' });
    setLoopGestureId(undefined);
    setPicking(undefined);
  }, [doc, setDoc]);
  const addGesture = (g: Gesture) => {
    setDoc({ ...doc, gestures: [...doc.gestures, g] });
    setSelection({ kind: 'gesture', id: g.id });
  };

  // ---- Selection -------------------------------------------------------------

  const noteRange = useMemo(() => {
    if (!score || selection.kind !== 'notes') return undefined;
    const idx = score.index;
    const a = idx.spans.get(selection.anchorId)?.[0];
    const b = idx.spans.get(selection.focusId)?.[0];
    if (!a || !b) return undefined;
    const [firstId, first] = a.qOn <= b.qOn ? [selection.anchorId, a] : [selection.focusId, b];
    const [lastId, last] = a.qOff >= b.qOff ? [selection.anchorId, a] : [selection.focusId, b];
    return {
      q0: first.qOn,
      q1: last.qOff,
      lastId,
      single: selection.anchorId === selection.focusId,
      from: anchorFor(idx, idx.measureOf.get(firstId) ?? 0, first.qOn),
      to: anchorFor(idx, idx.measureOf.get(lastId) ?? 0, last.qOff),
    };
  }, [score, selection]);

  restartQRef.current = noteRange?.q0 ?? 0;

  const selectedGesture = selection.kind === 'gesture' ? doc.gestures.find((g) => g.id === selection.id) : undefined;
  /** Where each gesture acts, in score positions (one span per pass through repeats). */
  const spansById = useMemo(() => {
    const spans = new Map<string, { lo: number; hi: number }[]>();
    for (const g of allTiming) {
      const [lo, hi] = extent(g);
      spans.set(g.id, [...(spans.get(g.id) ?? []), { lo, hi }]);
    }
    return spans;
  }, [allTiming]);
  /** Where each Slow down / Speed up starts from, and the basic tempo where it arrives (first pass). */
  const rampInfo = useMemo(() => {
    const info = new Map<string, RampInfo>();
    if (!score || !map) return info;
    const basicBpm = (q: number) => map.bpmAt(q) / map.ratioAt(q);
    for (const g of doc.gestures) {
      if (g.type !== 'ramp') continue;
      const [q0] = resolveAnchor(score.index, g.from);
      const [q1] = resolveAnchor(score.index, g.to);
      if (q0 === undefined || q1 === undefined) continue;
      const from = sectionLevelAt(allTiming, q0);
      info.set(g.id, { from, fromBpm: from * basicBpm(q0), basicBpm: basicBpm(Math.max(q0, q1 - 1e-6)) });
    }
    return info;
  }, [score, map, doc.gestures, allTiming]);
  const pickField = picking && picking.gestureId === selectedGesture?.id ? picking.field : undefined;

  const { selectedIds, rangeIds } = useMemo(() => {
    const sel = new Set<string>();
    const range = new Set<string>();
    if (!score) return { selectedIds: sel, rangeIds: range };
    let span: [number, number] | undefined;
    if (selection.kind === 'notes') {
      sel.add(selection.anchorId).add(selection.focusId);
      if (noteRange && !noteRange.single) span = [noteRange.q0, noteRange.q1];
    } else if (selectedGesture && selectedGesture.type !== 'breath') {
      const first = allTiming.find((g) => g.id === selectedGesture.id);
      if (first) span = extent(first);
    }
    if (span) {
      for (const [id, spans] of score.index.spans) if (spans[0].qOn >= span[0] - 1e-9 && spans[0].qOn < span[1] - 1e-9) range.add(id);
    }
    if (focusVoice && shaped) for (const p of shaped.parts) for (const n of p.notes) if (n.voice === focusVoice && n.id) range.add(n.id);
    return { selectedIds: sel, rangeIds: range };
  }, [score, selection, noteRange, selectedGesture, allTiming, focusVoice, shaped]);

  /** The selected note as it plays: its voice and velocity (the pass nearest the selection). */
  const selectedNote = useMemo(() => {
    if (!shaped || !dynamicsOn || selection.kind !== 'notes' || !noteRange?.single) return undefined;
    const matches = shaped.parts.flatMap((p) => p.notes.filter((n) => n.id === selection.anchorId));
    return matches.sort((a, b) => Math.abs(a.qOn - noteRange.q0) - Math.abs(b.qOn - noteRange.q0))[0];
  }, [shaped, dynamicsOn, selection, noteRange]);

  const breathMarkers = useMemo<BreathMarker[]>(() => {
    if (!score) return [];
    return doc.gestures.flatMap((g) => {
      if (g.type !== 'breath') return [];
      const q = resolveAnchor(score.index, g.at)[0];
      if (q === undefined) return [];
      const clamped = !!map?.breaths.some((b) => b.id === g.id && b.clamped);
      return [{ gestureId: g.id, q, selected: selection.kind === 'gesture' && selection.id === g.id, clamped, off: g.enabled === false }];
    });
  }, [score, doc.gestures, selection, map]);

  const onNoteClick = useCallback(
    (id: string, { shift, double }: { shift: boolean; double: boolean }) => {
      if (!score) return;
      if (pickField && selectedGesture) {
        // Anchor to the note's onset, in its own measure.
        const first = score.index.spans.get(id)?.[0];
        if (first) {
          const at = anchorFor(score.index, score.index.measureOf.get(id) ?? 0, first.qOn);
          updateGesture(selectedGesture.id, { [pickField]: at }, `${selectedGesture.id}:${pickField}`);
        }
        setPicking(undefined);
        return;
      }
      const span = nearestSpan(score.index.spans.get(id), playQRef.current);
      if (double && span) return seekTo(span.qOn, true);
      setSelection((s) => (shift && s.kind === 'notes' ? { ...s, focusId: id } : { kind: 'notes', anchorId: id, focusId: id }));
      if (!shift && span && !player.current?.playing) seekTo(span.qOn);
    },
    [score, seekTo, pickField, selectedGesture, updateGesture],
  );

  // ---- Actions ---------------------------------------------------------------

  const addBreath = () => {
    if (!noteRange) return;
    const existing = findBreath(doc.gestures, noteRange.to);
    if (existing) return setSelection({ kind: 'gesture', id: existing.id });
    const { extraMs } = BREATH_PRESETS[DEFAULT_BREATH_PRESET];
    addGesture({ id: newId(), type: 'breath', at: noteRange.to, staff: score?.staffOf.get(noteRange.lastId), extraMs });
  };

  const unusedBreathMarks = useMemo(
    () => (score ? score.breathMarks.filter((b) => !findBreath(doc.gestures, b.at)) : []),
    [score, doc.gestures],
  );
  const importBreathMarks = () => {
    const { extraMs } = BREATH_PRESETS[DEFAULT_BREATH_PRESET];
    const added = unusedBreathMarks.map(({ at, staff }): Gesture => ({ id: newId(), type: 'breath', at, staff, extraMs }));
    setDoc({ ...doc, gestures: [...doc.gestures, ...added] });
  };

  const addSection = (kind: SectionKind) => {
    if (!noteRange) return;
    const { from, to } = noteRange;
    const id = newId();
    if (kind === 'slower' || kind === 'faster') {
      const { change } = SECTION_DEFAULTS.ramp;
      const target = sectionLevelAt(allTiming, noteRange.q0) * (kind === 'slower' ? 1 - change : 1 + change);
      addGesture({ id, type: 'ramp', from, to, target: Math.round(target * 100) / 100 });
    }
    else if (kind === 'broaden' || kind === 'push') addGesture({ id, type: 'shape', gesture: kind, from, to, ...SECTION_DEFAULTS.shape });
    else addGesture({ id, type: 'aTempo', from, to });
  };

  const toggleLoop = useCallback(() => {
    if (selection.kind === 'gesture' && selection.id !== loopGestureId) setLoopGestureId(selection.id);
    else setLoopGestureId(undefined);
  }, [loopGestureId, selection]);

  const exportJson = () => score && downloadBlob(JSON.stringify(doc, null, 2), `${baseName(score.name)}.kplayer.json`, 'application/json');
  const exportMidi = () => {
    if (!score || !map) return;
    const bytes = renderPerformanceMidi(shaped ?? score.events, map, { parts: doc.parts });
    downloadBlob(bytes as Uint8Array<ArrayBuffer>, `${baseName(score.name)}.performance.mid`, 'audio/midi');
  };
  const importVoicing = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const dynamics = raw?.dynamics ?? (Array.isArray(raw?.voices) ? raw : undefined);
      if (!dynamics || !Array.isArray(dynamics.voices)) throw new Error(`${file.name} has no voicing in it.`);
      setDoc({ ...doc, dynamics });
      setFocusVoice(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const importJson = async (file: File) => {
    try {
      const imported = parseDoc(await file.text());
      if (score && imported.score && imported.score.sha256 !== score.sha256) {
        if (!confirm(`This performance was made for "${imported.score.name}", which differs from the open score. Load it anyway?`)) return;
      }
      // A file of phrasing alone keeps the voicing you have; one with its own dynamics brings them.
      setDoc({ ...imported, dynamics: imported.dynamics ?? doc.dynamics, score: score ? { name: score.name, sha256: score.sha256 } : imported.score });
      setSelection({ kind: 'none' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ---- Keyboard --------------------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') {
      e.preventDefault();
      void togglePlay();
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekTo(0);
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      history.redo();
    } else if (mod) {
      return;
    } else if (e.key === 'b' || e.key === 'B') {
      addBreath();
    } else if (e.key === 'l' || e.key === 'L') {
      toggleLoop();
    } else if (e.key === 'e' || e.key === 'E') {
      setExpressive((x) => !x);
    } else if (e.key === 'd' || e.key === 'D') {
      setDynamicsOn((x) => !x);
    } else if (e.key === 'h' || e.key === 'H') {
      setHall((h) => ({ ...h, on: !h.on }));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.kind === 'gesture') {
      e.preventDefault();
      deleteGesture(selection.id);
    } else if (e.key === 'Escape') {
      if (pickField) setPicking(undefined);
      else setSelection({ kind: 'none' });
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---- Render ----------------------------------------------------------------

  const position = score && map ? `${measureLabel(score, playQ)} · ${formatTime(map.T(playQ))} / ${formatTime(map.duration)}` : '';
  const loopLabel =
    score && loop ? `m. ${measureLabel(score, loop.q0, false)}–${measureLabel(score, loop.q1 - 1e-6, false)}` : undefined;

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void openFile(f);
      }}
    >
      <Transport
        title={score?.title}
        playing={playing}
        canPlay={!!score}
        position={position}
        bpm={map?.bpmAt(playQ)}
        bpmChange={map ? Math.round((map.ratioAt(playQ) - 1) * 100) : undefined}
        status={status ?? soundStatus}
        expressive={expressive}
        dynamics={dynamicsOn}
        hall={hall}
        tempoFactor={doc.tempoFactor}
        parts={score?.events.parts ?? []}
        partSettings={doc.parts}
        loopLabel={loopLabel}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onOpen={openFile}
        onImport={importJson}
        onExportJson={exportJson}
        onExportMidi={exportMidi}
        onPlayPause={togglePlay}
        onRewind={() => seekTo(0)}
        onExpressive={setExpressive}
        onDynamics={setDynamicsOn}
        onHall={setHall}
        onTempoFactor={(f) => setDoc({ ...doc, tempoFactor: f }, 'tempoFactor')}
        onPart={(i, s: PartSetting) => setDoc({ ...doc, parts: { ...doc.parts, [i]: s } }, `part:${i}`)}
        onStopLoop={() => setLoopGestureId(undefined)}
        onUndo={history.undo}
        onRedo={history.redo}
      />
      {error && (
        <div className="error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      {score && map ? (
        <>
          <main className="workspace">
            <ScoreView
              score={score}
              playQ={playQ}
              playing={playing}
              selectedIds={selectedIds}
              rangeIds={rangeIds}
              breaths={breathMarkers}
              picking={!!pickField}
              onNoteClick={onNoteClick}
              onBreathClick={(id) => setSelection({ kind: 'gesture', id })}
            />
            <Inspector
              index={score.index}
              noteSelection={noteRange}
              gesture={selectedGesture}
              gestures={doc.gestures}
              spans={spansById}
              rampInfo={rampInfo}
              playQ={playQ}
              breathResults={map.breaths}
              unusedBreathMarks={unusedBreathMarks.length}
              onImportBreathMarks={importBreathMarks}
              loopOn={!!loopGestureId && loopGestureId === selectedGesture?.id}
              onAddBreath={addBreath}
              onAddSection={addSection}
              onChange={updateGesture}
              onSetEnabled={setEnabled}
              onDelete={deleteGesture}
              onClearAll={clearAll}
              onToggleLoop={toggleLoop}
              picking={pickField}
              onPick={(field) => setPicking(field && selectedGesture ? { gestureId: selectedGesture.id, field } : undefined)}
              onSelect={(id) => setSelection({ kind: 'gesture', id })}
            >
              <DynamicsPanel
                dynamics={doc.dynamics}
                partNames={score.events.parts.map((p) => p.name)}
                on={dynamicsOn}
                focus={focusVoice}
                note={selectedNote}
                onChange={(dynamics, key) => setDoc({ ...doc, dynamics }, key)}
                onFocus={setFocusVoice}
                onImport={importVoicing}
              />
            </Inspector>
          </main>
          <TempoLane
            map={map}
            index={score.index}
            timing={allTiming}
            selectedId={selection.kind === 'gesture' ? selection.id : undefined}
            playQ={playQ}
            loop={loop}
            onSeek={(q) => seekTo(q)}
            onSelect={(id) => setSelection({ kind: 'gesture', id })}
          />
        </>
      ) : (
        <div className="empty">
          <h1>kplayer</h1>
          <p>Open a MusicXML score (.musicxml, .xml or .mxl), or drop one here.</p>
          <p>
            <label className="button primary">
              Open score…
              <input type="file" accept=".musicxml,.xml,.mxl" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
            </label>{' '}
            <button onClick={openDemo}>Try the demo song</button>
          </p>
          {(status ?? soundStatus) && <p className="muted">{status ?? soundStatus}</p>}
          <p className="credits muted">
            Piano: <a href="https://archive.org/details/SalamanderGrandPianoV3">Salamander Grand Piano</a> by Alexander Holm (CC-BY 3.0).
            Other instruments: MuseScore General (MIT).
          </p>
        </div>
      )}
    </div>
  );
}

const NO_TIMING: TimingGesture[] = [];

function findBreath(gestures: Gesture[], at: Anchor): Gesture | undefined {
  return gestures.find((g) => g.type === 'breath' && g.at.measureIndex === at.measureIndex && Math.abs(g.at.offsetQ - at.offsetQ) < 1e-6);
}

function extent(g: TimingGesture): [number, number] {
  if (g.kind === 'breath') return [g.start, g.end];
  if (g.kind === 'shape') return [g.start, g.end];
  return [g.q0, g.q1];
}

function measureLabel(score: LoadedScore, q: number, prefix = true): string {
  const m = playedMeasureAt(score.index, q);
  const label = m ? score.index.measures[m.measureIndex]?.label ?? '' : '';
  return prefix ? `m. ${label}` : label;
}

const newId = () => Math.random().toString(36).slice(2, 10);
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
