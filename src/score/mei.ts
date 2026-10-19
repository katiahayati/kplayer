// What the player needs from Verovio's MEI that its MIDI leaves out: which
// staff and voice (MEI layer) each note is written in, and the score's
// dynamics and hairpins. A plain scan over the tags, in document order:
// faster than a DOM for scores of thousands of notes, and Verovio's MEI is
// regular enough for it.

export interface MeiNote {
  id: string;
  staff: number;
  /** MEI layer: MusicXML's voice number (piano right hand 1–4, left hand 5–8 from MuseScore). */
  layer: number;
  /** MIDI pitch as written (sounding pitch for non-transposing instruments). */
  pitch?: number;
  grace: boolean;
}

/** A position in a measure: beat (1-based, as in MEI tstamp) of `beatQ` quarter notes. */
export interface MeiPosition {
  measureId: string;
  beat: number;
  beatQ: number;
}

export interface MeiDynamic extends MeiPosition {
  staff: number;
  /** As written: "pp", "mf", "sfz"… */
  text: string;
  /** MIDI velocity given by the notation program (MuseScore writes one), when there is one. */
  velocity?: number;
}

export interface MeiHairpin extends MeiPosition {
  staff: number;
  form: 'cres' | 'dim';
  /** Measures after the start measure where it ends, and the beat there (MEI tstamp2 "1m+3"). */
  endMeasures: number;
  endBeat: number;
}

export interface MeiContent {
  notes: MeiNote[];
  dynamics: MeiDynamic[];
  hairpins: MeiHairpin[];
}

/** A written dynamic or hairpin placed in the played score (once per pass through repeats). */
export interface DynamicMark {
  q: number;
  staff: number;
  text: string;
  velocity?: number;
}

export interface HairpinMark {
  q0: number;
  q1: number;
  staff: number;
  form: 'cres' | 'dim';
}

interface Measures {
  measures: { starts: number[] }[];
  measureIndexById: Map<string, number>;
}

/** Score positions of each pass through a measure position. */
function positions(index: Measures, p: MeiPosition, measuresAfter = 0, beat = p.beat): number[] {
  const i = index.measureIndexById.get(p.measureId);
  const m = i === undefined ? undefined : index.measures[i + measuresAfter];
  return m ? m.starts.map((s) => s + (beat - 1) * p.beatQ) : [];
}

export function placeMarks(index: Measures, content: MeiContent): { dynamics: DynamicMark[]; hairpins: HairpinMark[] } {
  const dynamics = content.dynamics.flatMap((d) =>
    positions(index, d).map((q) => ({ q, staff: d.staff, text: d.text, velocity: d.velocity })),
  );
  const hairpins = content.hairpins.flatMap((h) => {
    const ends = positions(index, h, h.endMeasures, h.endBeat);
    return positions(index, h).flatMap((q0, pass) => {
      const q1 = ends[pass] ?? ends.find((e) => e > q0);
      return q1 !== undefined && q1 > q0 ? [{ q0, q1, staff: h.staff, form: h.form }] : [];
    });
  });
  return { dynamics: dynamics.sort((a, b) => a.q - b.q), hairpins: hairpins.sort((a, b) => a.q0 - b.q0) };
}

/**
 * Tells each played note which score note it is: matched on staff, start and
 * pitch, once per pass through repeats. Notes it can't place (grace notes,
 * which Verovio's MIDI moves) are left as they are.
 */
export function attachNoteInfo<N extends { midi: number; qOn: number; staff?: number; id?: string; layer?: number }>(
  notes: N[],
  meiNotes: MeiNote[],
  spansOf: (id: string) => { qOn: number }[],
): void {
  // On Verovio's MIDI grid (120 per quarter), where tuplets can land a tick early or late.
  const tick = (q: number) => Math.round(q * 120);
  const key = (staff: number, t: number, pitch: number) => `${staff}|${t}|${pitch}`;
  const byKey = new Map<string, MeiNote>();
  for (const n of meiNotes) {
    if (n.pitch === undefined || n.grace) continue;
    for (const s of spansOf(n.id)) byKey.set(key(n.staff, tick(s.qOn), n.pitch), n);
  }
  for (const n of notes) {
    if (n.staff === undefined) continue;
    const t = tick(n.qOn);
    const m = [t, t - 1, t + 1].map((x) => byKey.get(key(n.staff!, x, n.midi))).find(Boolean);
    if (m) {
      n.id = m.id;
      n.layer = m.layer;
    }
  }
}

const STEPS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ALTER: Record<string, number> = { s: 1, f: -1, ss: 2, x: 2, ff: -2, xs: 3, ts: 3, tf: -3, n: 0, nf: -1, ns: 1 };

const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name.replace('.', '\\.')}="([^"]*)"`).exec(attrs)?.[1];

export function readMei(mei: string): MeiContent {
  const notes: MeiNote[] = [];
  const dynamics: MeiDynamic[] = [];
  const hairpins: MeiHairpin[] = [];
  let measureId = '';
  let staff = 0;
  let layer = 0;
  let beatQ = 1;
  let chordGrace = false;
  // The note being read: its <accid> children come before </note>.
  let open: { note: MeiNote; attrs: string; accid?: string } | undefined;

  const finish = () => {
    if (!open) return;
    const { note, attrs } = open;
    const pname = attr(attrs, 'pname.ges') ?? attr(attrs, 'pname');
    const oct = attr(attrs, 'oct.ges') ?? attr(attrs, 'oct');
    const accid = attr(attrs, 'accid.ges') ?? attr(attrs, 'accid') ?? open.accid;
    if (pname && oct && STEPS[pname] !== undefined) note.pitch = 12 * (Number(oct) + 1) + STEPS[pname] + (ALTER[accid ?? 'n'] ?? 0);
    notes.push(note);
    open = undefined;
  };

  const tags = /<(\/?)([A-Za-z]+)\b([^>]*?)(\/?)>/g;
  for (let m = tags.exec(mei); m; m = tags.exec(mei)) {
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      if (name === 'note') finish();
      else if (name === 'chord') chordGrace = false;
      continue;
    }
    switch (name) {
      case 'measure':
        measureId = attr(attrs, 'xml:id') ?? '';
        break;
      case 'scoreDef':
      case 'staffDef': {
        const unit = attr(attrs, 'meter.unit');
        if (unit) beatQ = 4 / Number(unit);
        break;
      }
      case 'meterSig': {
        const unit = attr(attrs, 'unit');
        if (unit) beatQ = 4 / Number(unit);
        break;
      }
      case 'staff':
        staff = Number(attr(attrs, 'n') ?? 0);
        break;
      case 'layer':
        layer = Number(attr(attrs, 'n') ?? 0);
        break;
      case 'chord':
        chordGrace = attr(attrs, 'grace') !== undefined;
        break;
      case 'note': {
        finish();
        const id = attr(attrs, 'xml:id');
        if (!id) break;
        open = { note: { id, staff, layer, grace: chordGrace || attr(attrs, 'grace') !== undefined }, attrs };
        if (selfClosing) finish();
        break;
      }
      case 'accid': {
        const a = attr(attrs, 'accid.ges') ?? attr(attrs, 'accid');
        if (open && a) open.accid = a;
        break;
      }
      case 'dynam': {
        const end = mei.indexOf('</dynam>', tags.lastIndex);
        const text = (selfClosing || end < 0 ? '' : mei.slice(tags.lastIndex, end)).replace(/<[^>]*>/g, '').trim();
        const val = attr(attrs, 'val');
        dynamics.push({
          measureId,
          staff: Number(attr(attrs, 'staff')?.split(' ')[0] ?? staff),
          beat: Number(attr(attrs, 'tstamp') ?? 1),
          beatQ,
          text,
          velocity: val ? Number(val) : undefined,
        });
        break;
      }
      case 'hairpin': {
        const form = attr(attrs, 'form');
        const end = /^(\d+)m\+([\d.]+)$/.exec(attr(attrs, 'tstamp2') ?? '');
        if ((form === 'cres' || form === 'dim') && end) {
          hairpins.push({
            measureId,
            staff: Number(attr(attrs, 'staff')?.split(' ')[0] ?? staff),
            beat: Number(attr(attrs, 'tstamp') ?? 1),
            beatQ,
            form,
            endMeasures: Number(end[1]),
            endBeat: Number(end[2]),
          });
        }
        break;
      }
    }
  }
  finish();
  return { notes, dynamics, hairpins };
}
