// Autosave of performance documents in IndexedDB (keyed by the score's SHA-256),
// plus JSON import/export of the sidecar file.

import { emptyDoc, type Anchor, type Gesture, type PerformanceDoc, type RampGesture } from '../perf/types';

const DB_NAME = 'kplayer';
const STORE = 'performances';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSaved(sha256: string): Promise<PerformanceDoc | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(sha256);
      req.onsuccess = () => resolve(req.result ? parseDoc(req.result) : undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function save(sha256: string, doc: PerformanceDoc): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(doc, sha256);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private windows or blocked storage: the JSON export still works.
  }
}

export function parseDoc(raw: unknown): PerformanceDoc {
  const doc = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Omit<Partial<PerformanceDoc>, 'version'> & { version?: number };
  if (!doc || (doc.version !== 1 && doc.version !== 2) || !Array.isArray(doc.gestures)) throw new Error('Not a kplayer performance file');
  let gestures = doc.gestures.map(dropLegacyFields);
  if (doc.version === 1) gestures = sectionsToTargets(gestures);
  return { ...emptyDoc(), ...doc, version: 2, parts: doc.parts ?? {}, gestures };
}

/**
 * Version 1 stored each Slow down / Speed up as a change relative to the tempo
 * before it ("15% slower"); version 2 stores the tempo it arrives at, relative to
 * the basic tempo. Walking the sections in order converts one to the other, so
 * the file plays exactly as before.
 */
function sectionsToTargets(gestures: Gesture[]): Gesture[] {
  type Old = { dir?: 'slower' | 'faster'; amount?: number };
  const at = (a: Anchor) => a.measureIndex * 1e4 + a.offsetQ;
  const sections = gestures.filter((g) => g.type === 'ramp' || g.type === 'aTempo').sort((a, b) => at(a.from) - at(b.from));
  const targets = new Map<string, number>();
  let level = 1;
  for (const g of sections) {
    if (g.type === 'aTempo') {
      if (g.enabled !== false) level = 1;
      continue;
    }
    const { dir, amount = 0 } = g as Old;
    const ratio = dir === 'slower' ? 1 - Math.min(Math.max(amount, 0), 0.8) : 1 + Math.min(Math.max(amount, 0), 3);
    targets.set(g.id, level * ratio);
    // A switched-off section didn't move the tempo then, so it doesn't now.
    if (g.enabled !== false) level *= ratio;
  }
  return gestures.map((g) => {
    if (g.type !== 'ramp') return g;
    const { dir: _dir, amount: _amount, ...rest } = g as RampGesture & Old;
    return { ...rest, target: Math.round((targets.get(g.id) ?? 1) * 1e5) / 1e5 };
  });
}

/** Breaths used to carry ease lengths; they now always span the note before the breath. */
function dropLegacyFields(g: Gesture): Gesture {
  if (g.type !== 'breath') return g;
  const { beforeQ: _before, afterQ: _after, ...rest } = g as Gesture & { beforeQ?: number; afterQ?: number };
  return rest;
}

export function downloadBlob(data: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
