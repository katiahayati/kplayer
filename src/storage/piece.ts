// A piece file (.kplayer): one file with the score and everything kplayer adds to it
// (phrasing, voicing and dynamics, tempo, part mix), so opening it gets it all back.
// It's JSON, with the score file inside as base64 (an .mxl is already compressed).

import type { PerformanceDoc } from '../perf/types';
import { parseDoc } from './persist';

export const PIECE_EXTENSION = '.kplayer';
/** What the Open buttons accept: a score, or a piece. */
export const OPEN_ACCEPT = `.musicxml,.xml,.mxl,${PIECE_EXTENSION}`;

interface PieceFile {
  kplayer: 'piece';
  version: 1;
  title?: string;
  score: { name: string; sha256: string; data: string };
  performance: PerformanceDoc;
}

export interface Piece {
  title?: string;
  score: { name: string; sha256: string; bytes: Uint8Array };
  performance: PerformanceDoc;
}

export function writePiece(piece: Piece): string {
  const file: PieceFile = {
    kplayer: 'piece',
    version: 1,
    title: piece.title,
    score: { name: piece.score.name, sha256: piece.score.sha256, data: toBase64(piece.score.bytes) },
    performance: { ...piece.performance, score: { name: piece.score.name, sha256: piece.score.sha256 } },
  };
  return JSON.stringify(file);
}

/** Whether a file's contents are a piece rather than a score (MusicXML starts with "<", .mxl with "PK"). */
export function looksLikePiece(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 200)).trimStart();
  return head.startsWith('{') && /"kplayer"\s*:\s*"piece"/.test(head);
}

export function readPiece(text: string): Piece {
  const raw = JSON.parse(text) as Partial<PieceFile>;
  if (raw.kplayer !== 'piece' || !raw.score?.data) throw new Error('This file is not a kplayer piece.');
  if (raw.version !== 1) throw new Error(`This piece was saved by a newer kplayer (version ${raw.version}).`);
  return {
    title: raw.title,
    score: { name: raw.score.name, sha256: raw.score.sha256, bytes: fromBase64(raw.score.data) },
    performance: parseDoc(raw.performance),
  };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
