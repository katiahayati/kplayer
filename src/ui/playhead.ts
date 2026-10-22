// Where the playhead is. It moves on every animation frame while playing, so it
// lives outside React state: the few things that show it subscribe, each to
// just what it displays (the bar and time to a tenth of a second, the tempo
// lane's pixel, the notes sounding), and redraw only when that changes.

import { useSyncExternalStore } from 'react';

export interface Playhead {
  /** The playhead, in score position (quarter notes). */
  get(): number;
  set(q: number): void;
  subscribe(listener: () => void): () => void;
}

export function createPlayhead(): Playhead {
  let q = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => q,
    set(next) {
      if (next === q) return;
      q = next;
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/**
 * A value derived from the playhead, re-rendering only when it changes. `select` must return a primitive
 * (a string or number), so that equal values compare equal.
 */
export function usePlayhead<T extends string | number | boolean>(playhead: Playhead, select: (q: number) => T): T {
  return useSyncExternalStore(playhead.subscribe, () => select(playhead.get()));
}
