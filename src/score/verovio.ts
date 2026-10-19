// Loads a MusicXML score with Verovio and extracts everything the player needs:
// SVG pages for display, the timemap (which notes sound when, in score
// positions), and the score's own MIDI (pitches, parts, written tempos).

import type { VerovioToolkit } from 'verovio/esm';
import { buildScoreIndex, type ScoreIndex, type Span, type TimemapEntry } from '../perf/anchors';
import { parseScoreMidi, type ScoreEvents } from '../perf/render';
import { findBreathMarks, staffOfElements, type WrittenBreath } from './breathMarks';

export interface RenderedScore {
  pages: string[];
  timemap: TimemapEntry[];
  index: ScoreIndex;
  events: ScoreEvents;
  /** Base note/rest ID → staff number. */
  staffOf: Map<string, string>;
  /** Staff number → spans of its notes and rests (every pass), for finding the note before a breath. */
  staffSpans: Map<string, Span[]>;
  /** Breath marks written in the score, anchored after the note each follows. */
  breathMarks: WrittenBreath[];
}

export interface LoadedScore extends RenderedScore {
  name: string;
  sha256: string;
  title: string;
}

export const VEROVIO_OPTIONS = {
  svgViewBox: true,
  adjustPageHeight: true,
  breaks: 'auto',
  pageWidth: 2200,
  pageHeight: 60000,
  pageMarginTop: 60,
  pageMarginBottom: 60,
  scale: 40,
  footer: 'none',
};

let toolkit: Promise<VerovioToolkit> | undefined;

function getToolkit(): Promise<VerovioToolkit> {
  // Loaded on first use: the module is ~7 MB with its WASM inlined.
  toolkit ??= Promise.all([import('verovio/wasm'), import('verovio/esm')]).then(
    async ([wasm, esm]) => new esm.VerovioToolkit(await wasm.default()),
  );
  return toolkit;
}

export async function loadScore(file: File): Promise<LoadedScore> {
  const tk = await getToolkit();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": compressed .mxl

  tk.setOptions(VEROVIO_OPTIONS);
  const ok = isZip ? tk.loadZipDataBuffer(buffer) : tk.loadData(new TextDecoder().decode(bytes));
  if (!ok) throw new Error(`Verovio couldn't read ${file.name}. Is it MusicXML (.musicxml, .xml or .mxl)?`);

  const rendered = renderLoaded(tk);
  return {
    ...rendered,
    name: file.name,
    sha256: await sha256(bytes),
    title: titleFrom(rendered.pages[0]) ?? file.name.replace(/\.[^.]+$/, ''),
  };
}

/** Everything the player needs from a toolkit that has a score loaded. */
export function renderLoaded(tk: VerovioToolkit): RenderedScore {
  const pages: string[] = [];
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(tk.renderToSVG(p));
  const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true }) as TimemapEntry[];
  const events = parseScoreMidi(base64ToBytes(tk.renderToMIDI()));
  const attrs = new Map<string, Record<string, string>>();
  const attrOf = (id: string) => {
    if (!attrs.has(id)) attrs.set(id, tk.getElementAttr(id));
    return attrs.get(id)!;
  };
  const index = buildScoreIndex(timemap, (id) => attrOf(id).n ?? '', events.endQ);

  const docs = pages.map((p) => new DOMParser().parseFromString(p, 'image/svg+xml'));
  const staffOf = staffOfElements(docs, attrOf);
  const staffSpans = new Map<string, Span[]>();
  for (const [id, spans] of index.spans) {
    const staff = staffOf.get(id);
    if (staff === undefined) continue;
    if (!staffSpans.has(staff)) staffSpans.set(staff, []);
    staffSpans.get(staff)!.push(...spans);
  }
  return { pages, timemap, index, events, staffOf, staffSpans, breathMarks: findBreathMarks(docs, index, attrOf) };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function titleFrom(svg: string | undefined): string | undefined {
  if (!svg) return undefined;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const text = doc.querySelector('.pgHead text')?.textContent?.trim();
  return text || undefined;
}
