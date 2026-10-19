// Autosave of performance documents in IndexedDB (keyed by the score's SHA-256),
// plus JSON import/export of the sidecar file.

import { emptyDoc, type Gesture, type PerformanceDoc } from '../perf/types';

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
  const doc = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<PerformanceDoc>;
  if (!doc || doc.version !== 1 || !Array.isArray(doc.gestures)) throw new Error('Not a kplayer performance file');
  return { ...emptyDoc(), ...doc, parts: doc.parts ?? {}, gestures: doc.gestures.map(dropLegacyFields) };
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
