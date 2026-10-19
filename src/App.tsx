import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player } from './audio/player';
import { anchorFor, loopAround, nearestSpan, noteBefore, playedMeasureAt, resolveAnchor } from './perf/anchors';
import { compileGestures } from './perf/compile';
import { BREATH_PRESETS, DEFAULT_BREATH_PRESET, SECTION_DEFAULTS } from './perf/presets';
import { renderPerformanceMidi } from './perf/render';
import { buildTimeMap, type TimeMap, type TimingGesture } from './perf/timeline';
import { emptyDoc, type Anchor, type Gesture, type PartSetting, type PerformanceDoc } from './perf/types';
import { ScoreView, type BreathMarker } from './score/ScoreView';
import { loadScore, type LoadedScore } from './score/verovio';
import { downloadBlob, loadSaved, parseDoc, save } from './storage/persist';
import { Inspector, type SectionKind } from './ui/Inspector';
import { formatTime, TempoLane } from './ui/TempoLane';
import { Transport } from './ui/Transport';
import { useHistory } from './ui/useHistory';

const SOUNDFONT_URL = `${import.meta.env.BASE_URL}soundfonts/MuseScore_General.sf3`;
const DEMO_URL = `${import.meta.env.BASE_URL}demo/song.musicxml`;

type Selection = { kind: 'none' } | { kind: 'notes'; anchorId: string; focusId: string } | { kind: 'gesture'; id: string };

export default function App() {
  const [score, setScore] = useState<LoadedScore>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const history = useHistory<PerformanceDoc>(emptyDoc());
  const doc = history.value;
  const [expressive, setExpressive] = useState(true);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [loopGestureId, setLoopGestureId] = useState<string>();
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

  // ---- Timing --------------------------------------------------------------

  const allTiming = useMemo(
    () =>
      score
        ? compileGestures(
            doc.gestures,
            (a) => resolveAnchor(score.index, a),
            (q, staff) => noteBefore(score.staffSpans, q, staff),
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

  const midi = useMemo(
    () => (score && map ? renderPerformanceMidi(score.events, map, { parts: doc.parts, loop }) : undefined),
    [score, map, doc.parts, loop],
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
    if (q >= map.endQ - 1e-6) q = 0;
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
    const tick = () => {
      const p = player.current;
      const m = loadedMap.current;
      if (p && m) {
        const on = p.playing;
        setPlaying(on);
        if (on) setPlayQ(Math.min(m.qAt(p.time), m.endQ));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ensurePlayer = useCallback(async (): Promise<Player | undefined> => {
    if (player.current) return player.current;
    try {
      playerLoading.current ??= Player.create(SOUNDFONT_URL, setStatus);
      player.current = await playerLoading.current;
      return player.current;
    } catch (e) {
      playerLoading.current = undefined;
      setError(`Couldn't start audio: ${(e as Error).message}. Did you run "npm run fetch-soundfont"?`);
    } finally {
      setStatus(undefined);
    }
  }, []);

  const togglePlay = useCallback(async () => {
    if (!score) return;
    const fresh = !player.current;
    const p = await ensurePlayer();
    if (!p) return;
    if (fresh) return pushToPlayer({ play: true });
    if (p.playing) return p.pause();
    const m = loadedMap.current;
    if (m && (p.finished || playQRef.current >= m.endQ - 1e-6)) {
      pendingQ.current = 0;
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
      } else if (play) {
        void togglePlay();
      }
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
  const deleteGesture = useCallback(
    (id: string) => {
      setDoc({ ...doc, gestures: doc.gestures.filter((g) => g.id !== id) });
      setSelection({ kind: 'none' });
      if (loopGestureId === id) setLoopGestureId(undefined);
    },
    [doc, setDoc, loopGestureId],
  );
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

  const selectedGesture = selection.kind === 'gesture' ? doc.gestures.find((g) => g.id === selection.id) : undefined;

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
    return { selectedIds: sel, rangeIds: range };
  }, [score, selection, noteRange, selectedGesture, allTiming]);

  const breathMarkers = useMemo<BreathMarker[]>(() => {
    if (!score) return [];
    return doc.gestures.flatMap((g) => {
      if (g.type !== 'breath') return [];
      const q = resolveAnchor(score.index, g.at)[0];
      if (q === undefined) return [];
      const clamped = !!map?.breaths.some((b) => b.id === g.id && b.clamped);
      return [{ gestureId: g.id, q, selected: selection.kind === 'gesture' && selection.id === g.id, clamped }];
    });
  }, [score, doc.gestures, selection, map]);

  const onNoteClick = useCallback(
    (id: string, { shift, double }: { shift: boolean; double: boolean }) => {
      if (!score) return;
      const span = nearestSpan(score.index.spans.get(id), playQRef.current);
      if (double && span) return seekTo(span.qOn, true);
      setSelection((s) => (shift && s.kind === 'notes' ? { ...s, focusId: id } : { kind: 'notes', anchorId: id, focusId: id }));
      if (!shift && span && !player.current?.playing) seekTo(span.qOn);
    },
    [score, seekTo],
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
    if (kind === 'slower' || kind === 'faster') addGesture({ id, type: 'ramp', dir: kind, from, to, ...SECTION_DEFAULTS.ramp });
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
    const bytes = renderPerformanceMidi(score.events, map, { parts: doc.parts });
    downloadBlob(bytes as Uint8Array<ArrayBuffer>, `${baseName(score.name)}.performance.mid`, 'audio/midi');
  };
  const importJson = async (file: File) => {
    try {
      const imported = parseDoc(await file.text());
      if (score && imported.score && imported.score.sha256 !== score.sha256) {
        if (!confirm(`This performance was made for "${imported.score.name}", which differs from the open score. Load it anyway?`)) return;
      }
      setDoc({ ...imported, score: score ? { name: score.name, sha256: score.sha256 } : imported.score });
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.kind === 'gesture') {
      e.preventDefault();
      deleteGesture(selection.id);
    } else if (e.key === 'Escape') {
      setSelection({ kind: 'none' });
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
        status={status}
        expressive={expressive}
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
        onExpressive={setExpressive}
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
              onNoteClick={onNoteClick}
              onBreathClick={(id) => setSelection({ kind: 'gesture', id })}
            />
            <Inspector
              index={score.index}
              noteSelection={noteRange}
              gesture={selectedGesture}
              gestures={doc.gestures}
              breathResults={map.breaths}
              unusedBreathMarks={unusedBreathMarks.length}
              onImportBreathMarks={importBreathMarks}
              loopOn={!!loopGestureId && loopGestureId === selectedGesture?.id}
              onAddBreath={addBreath}
              onAddSection={addSection}
              onChange={updateGesture}
              onDelete={deleteGesture}
              onToggleLoop={toggleLoop}
              onSelect={(id) => setSelection({ kind: 'gesture', id })}
            />
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
          {status && <p className="muted">{status}</p>}
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
  if (g.kind === 'breath') return [g.start, g.q];
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
