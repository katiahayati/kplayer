import { useCallback, useReducer } from 'react';

interface State<T> {
  past: T[];
  present: T;
  future: T[];
  /** Consecutive edits with the same key (e.g. one slider drag) merge into one undo step. */
  lastKey?: string;
  lastAt: number;
}

type Action<T> =
  | { type: 'set'; value: T; key?: string }
  | { type: 'reset'; value: T }
  | { type: 'undo' }
  | { type: 'redo' };

const COALESCE_MS = 1200;
const LIMIT = 200;

function reducer<T>(s: State<T>, a: Action<T>): State<T> {
  const now = Date.now();
  switch (a.type) {
    case 'reset':
      return { past: [], present: a.value, future: [], lastAt: now };
    case 'set': {
      if (a.value === s.present) return s;
      const merge = a.key !== undefined && a.key === s.lastKey && now - s.lastAt < COALESCE_MS;
      return {
        past: merge ? s.past : [...s.past, s.present].slice(-LIMIT),
        present: a.value,
        future: [],
        lastKey: a.key,
        lastAt: now,
      };
    }
    case 'undo':
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], lastAt: now };
    case 'redo':
      if (!s.future.length) return s;
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), lastAt: now };
  }
}

export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [], lastAt: 0 });
  return {
    value: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    set: useCallback((value: T, key?: string) => dispatch({ type: 'set', value, key }), []),
    reset: useCallback((value: T) => dispatch({ type: 'reset', value }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
  };
}
