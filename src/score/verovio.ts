// Loads a MusicXML score with Verovio and extracts everything the player needs:
// SVG pages for display, the timemap (which notes sound when, in score
// positions), and the score's own MIDI (pitches, parts, written tempos).

import type { VerovioToolkit } from 'verovio/esm';
import { buildScoreIndex, type ScoreIndex, type Span, type TimemapEntry } from '../perf/anchors';
import { parseScoreMidi, type ScoreEvents } from '../perf/render';
import { findBreathMarks, staffOfElements, type WrittenBreath } from './breathMarks';
import { attachNoteInfo, placeMarks, readMei, type DynamicMark, type HairpinMark } from './mei';
import { expandTremolos, findTremolos } from './tremolos';

export interface RenderedScore {
  pages: string[];
  timemap: TimemapEntry[];
  index: ScoreIndex;
  events: ScoreEvents;
  /** Base note/rest ID → staff number. */
  staffOf: Map<string, string>;
  /** Staff number → spans of its noteheads and rests (every pass), for finding the notes around a breath. */
  staffSpans: Map<string, Span[]>;
  /** Breath marks written in the score, anchored after the note each follows. */
  breathMarks: WrittenBreath[];
  /** Written dynamics and hairpins, placed in the played score. */
  dynamics: DynamicMark[];
  hairpins: HairpinMark[];
  /** Note ID → its pitch as spelled in the score ("D♯5"). */
  pitchNames: Map<string, string>;
}

export interface LoadedScore extends RenderedScore {
  name: string;
  sha256: string;
  title: string;
  /** The score file as opened, to save with the performance in a piece file. */
  bytes: Uint8Array;
}

export const VEROVIO_OPTIONS = {
  svgViewBox: true,
  adjustPageHeight: true,
  breaks: 'auto',
  pageWidth: 2200,
  // About a screenful of systems per page: off-screen pages then cost nothing to draw (see .svg-pages .page).
  pageHeight: 2000,
  pageMarginTop: 60,
  pageMarginBottom: 60,
  scale: 40,
  footer: 'none',
};

let toolkit: Promise<VerovioToolkit> | undefined;
/** The score the toolkit holds, for laying it out again. */
let loaded: LoadedScore | undefined;

function getToolkit(): Promise<VerovioToolkit> {
  // Loaded on first use: the module is ~7 MB with its WASM inlined.
  toolkit ??= Promise.all([import('verovio/wasm'), import('verovio/esm')]).then(
    async ([wasm, esm]) => new esm.VerovioToolkit(await wasm.default()),
  );
  return toolkit;
}

/** Loads a MusicXML score (.musicxml / .xml, or compressed .mxl) from the file's contents. */
export async function loadScore(name: string, bytes: Uint8Array): Promise<LoadedScore> {
  const tk = await getToolkit();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": compressed .mxl

  tk.setOptions(VEROVIO_OPTIONS);
  const ok = isZip ? tk.loadZipDataBuffer(bytes.slice().buffer as ArrayBuffer) : tk.loadData(new TextDecoder().decode(bytes));
  if (!ok) throw new Error(`Couldn't read ${name} as a score. kplayer opens MusicXML (.musicxml, .xml or .mxl, exported from MuseScore or Sibelius) and kplayer pieces (.kplayer).`);

  const rendered = renderLoaded(tk);
  loaded = {
    ...rendered,
    name,
    sha256: await sha256(bytes),
    title: titleFrom(rendered.pages[0]) ?? name.replace(/\.[^.]+$/, ''),
    bytes,
  };
  return loaded;
}

/**
 * The score's pages laid out for another page width: a narrower page has fewer bars to a line, so the notation
 * is larger on a small screen. Notes keep their IDs, so selections and the playhead carry over. Undefined when
 * another score has been loaded since.
 */
export async function layoutPages(score: LoadedScore, pageWidth: number): Promise<string[] | undefined> {
  const tk = await getToolkit();
  if (loaded !== score) return undefined;
  tk.setOptions({ ...VEROVIO_OPTIONS, pageWidth });
  tk.redoLayout();
  const pages: string[] = [];
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(tk.renderToSVG(p));
  return pages;
}

/** Everything the player needs from a toolkit that has a score loaded. */
export function renderLoaded(tk: VerovioToolkit, { tremolos: expand = true } = {}): RenderedScore {
  const pages: string[] = [];
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(tk.renderToSVG(p));
  const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true }) as TimemapEntry[];
  const midiEvents = parseScoreMidi(base64ToBytes(tk.renderToMIDI()));
  const attrs = new Map<string, Record<string, string>>();
  const attrOf = (id: string) => {
    if (!attrs.has(id)) attrs.set(id, tk.getElementAttr(id));
    return attrs.get(id)!;
  };
  const index = buildScoreIndex(timemap, (id) => attrOf(id).n ?? '', midiEvents.endQ);
  const mei = tk.getMEI();
  const content = readMei(mei);
  for (const part of midiEvents.parts) attachNoteInfo(part.notes, content.notes, (id) => index.spans.get(id) ?? []);
  // Verovio's MIDI drops fingered tremolos; put them back.
  const tremolos = expand ? findTremolos(mei) : [];
  const events = tremolos.length
    ? expandTremolos(midiEvents, tremolos, (id) => tk.getMIDIValuesForElement(id).pitch, (id) => index.spans.get(id) ?? [])
    : midiEvents;

  const docs = pages.map((p) => new DOMParser().parseFromString(p, 'image/svg+xml'));
  const staffOf = staffOfElements(docs, attrOf);
  const staffSpans = new Map<string, Span[]>();
  for (const [id, spans] of index.spans) {
    const staff = staffOf.get(id);
    if (staff === undefined) continue;
    if (!staffSpans.has(staff)) staffSpans.set(staff, []);
    staffSpans.get(staff)!.push(...spans);
  }
  const pitchNames = new Map(content.notes.flatMap((n) => (n.name ? [[n.id, n.name] as const] : [])));
  return { pages, timemap, index, events, staffOf, staffSpans, breathMarks: findBreathMarks(docs, index, attrOf), ...placeMarks(index, content), pitchNames };
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
