// Loads a MusicXML score in Node through the same Verovio pipeline the app uses.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { renderLoaded, VEROVIO_OPTIONS, type RenderedScore } from '../../src/score/verovio';

export interface NodeScore extends RenderedScore {
  name: string;
  sha256: string;
  /** Note ID → its lyric syllable (punctuation included), for notes that have one. */
  lyrics: Map<string, string>;
}

export async function loadScoreFile(file: string, options: { tremolos?: boolean } = {}): Promise<NodeScore> {
  globalThis.DOMParser ??= new Window().DOMParser as unknown as typeof DOMParser;
  const { default: createModule } = await import('verovio/wasm');
  const { VerovioToolkit } = await import('verovio/esm');
  const tk = new VerovioToolkit(await createModule());
  tk.setOptions(VEROVIO_OPTIONS);
  const bytes = fs.readFileSync(file);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ok = isZip ? tk.loadZipDataBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : tk.loadData(bytes.toString('utf8'));
  if (!ok) throw new Error(`Verovio couldn't read ${file}`);
  return {
    ...renderLoaded(tk, options),
    name: path.basename(file),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    lyrics: lyricsFromMei(tk.getMEI()),
  };
}

/** Pulls `<syl>` text out of each `<note>` in MEI. A plain scan: notes don't nest. */
function lyricsFromMei(mei: string): Map<string, string> {
  const out = new Map<string, string>();
  const open = /<note\b([^>]*?)(\/?)>/g;
  for (let m = open.exec(mei); m; m = open.exec(mei)) {
    if (m[2] === '/') continue;
    const id = /xml:id="([^"]+)"/.exec(m[1])?.[1];
    const end = mei.indexOf('</note>', open.lastIndex);
    if (!id || end < 0) continue;
    const syl = [...mei.slice(open.lastIndex, end).matchAll(/<syl\b[^>]*>([^<]*)<\/syl>/g)].map((s) => s[1]).join('');
    if (syl) out.set(id, syl);
  }
  return out;
}
