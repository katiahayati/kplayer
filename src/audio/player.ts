// Thin wrapper over SpessaSynth: a SoundFont synth plus its MIDI sequencer, playing
// into a concert hall. The app hands it finished performance MIDI files (already
// expressively timed) and reads back the playback position in performance seconds.

import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { HALL, hallImpulse } from './hall';

export interface SoundBankSource {
  id: string;
  url: string;
  /** Skip it (rather than fail) when the file is missing. */
  optional?: boolean;
}

export interface LoadOptions {
  /** Performance time the file's tick 0 corresponds to (non-zero for loop windows). */
  offset?: number;
  loop?: boolean;
  /** Performance time to start from. */
  at?: number;
  play?: boolean;
}

let context: AudioContext | undefined;

/**
 * The page's one audio context. It can be made (and sounds loaded into it) before anyone
 * clicks, but browsers keep it silent until `unlockAudio` is called from a click or key press.
 */
function audioContext(): AudioContext {
  return (context ??= new AudioContext());
}

/** Lets audio play; call it straight from a click or key press, before anything is awaited. */
export function unlockAudio(): void {
  void context?.resume();
}

/** How far the smoothed playhead may run ahead of the audio clock (which moves in steps of a few ms). */
const AHEAD_OF_AUDIO = 0.1;

export class Player {
  private offset = 0;
  /** Where the loaded piece starts, in performance seconds: the playhead waits there while it's prepared. */
  private startAt = 0;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly seq: Sequencer,
    private readonly wet: GainNode,
    private readonly master: GainNode,
  ) {}

  /**
   * Starts the synth with the given sound banks, downloading them together. Earlier banks take
   * priority: a piano bank listed first replaces the general bank's piano only.
   */
  static async create(banks: SoundBankSource[], onProgress?: (msg: string) => void): Promise<Player> {
    const ctx = audioContext();
    onProgress?.('Loading sounds…');
    const [, ...data] = await Promise.all([ctx.audioWorklet.addModule(processorUrl), ...download(banks, onProgress)]);
    // Downloaded; unpacking the samples takes a moment more.
    onProgress?.('Preparing sounds…');
    const synth = new WorkletSynthesizer(ctx);

    // Straight to the speakers, and through the hall (bass kept out of it); both through the volume, and a
    // limiter that keeps a turned-up piece's loudest chords from distorting (untouched at the usual volume).
    const input = ctx.createGain();
    const master = new GainNode(ctx);
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.15 });
    master.connect(limiter).connect(ctx.destination);
    const highPass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: HALL.highpassHz, Q: 20 * Math.log10(Math.SQRT1_2) });
    const hall = new ConvolverNode(ctx, { disableNormalization: true });
    const [left, right] = hallImpulse(ctx.sampleRate);
    const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
    ir.copyToChannel(left, 0);
    ir.copyToChannel(right, 1);
    hall.buffer = ir;
    const wet = new GainNode(ctx, { gain: HALL.wetGain });
    synth.connect(input);
    input.connect(master);
    input.connect(highPass).connect(hall).connect(wet).connect(master);

    const loaded: string[] = [];
    for (const [i, bank] of banks.entries()) {
      const buf = data[i];
      if (!buf) continue;
      await synth.soundBankManager.addSoundBank(buf, bank.id);
      loaded.push(bank.id);
    }
    synth.soundBankManager.priorityOrder = loaded;
    await synth.isReady;
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    return new Player(ctx, seq, wet, master);
  }

  /** Replaces what's playing, keeping play/pause state unless told otherwise. */
  load(midi: Uint8Array, opts: LoadOptions = {}): void {
    const wasPlaying = !this.seq.paused;
    this.offset = opts.offset ?? 0;
    const binary = midi.slice().buffer as ArrayBuffer;
    this.seq.loadNewSongList([{ binary, fileName: 'performance.mid' }]);
    this.seq.loopCount = opts.loop ? Infinity : 0;
    this.seek(opts.at ?? this.offset);
    if (opts.play ?? wasPlaying) this.play();
    else this.seq.pause();
  }

  /** How much hall: 0 for none, 1 for the usual amount. */
  setHall(level: number): void {
    this.wet.gain.setTargetAtTime(HALL.wetGain * Math.max(0, level), this.ctx.currentTime, 0.05);
  }

  /** The whole piece louder or softer, in dB (0 as it plays). */
  setVolume(db: number): void {
    this.master.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, 0.05);
  }

  play(): void {
    void this.ctx.resume();
    this.seq.play();
  }

  pause(): void {
    this.seq.pause();
  }

  get playing(): boolean {
    return !this.seq.paused;
  }

  get finished(): boolean {
    return this.seq.isFinished;
  }

  /**
   * The synth is getting a newly loaded piece ready: unpacking every sample it uses, the first time, which
   * holds up the audio for seconds (longer on a phone). Play waits for it.
   */
  get preparing(): boolean {
    return this.seq.midiData === undefined;
  }

  /**
   * Smoothed playback position in performance seconds. The smoothing runs on the wall clock and only slowly
   * follows the audio, so while the audio is held up it would run ahead and then jump back: it's kept with
   * the audio instead.
   */
  get time(): number {
    if (this.preparing) return this.startAt;
    return this.offset + Math.min(this.seq.currentHighResolutionTime, this.seq.currentTime + AHEAD_OF_AUDIO);
  }

  seek(t: number): void {
    const at = Math.max(0, t - this.offset);
    this.seq.currentTime = at;
    this.startAt = this.offset + at;
  }
}

/**
 * Starts downloading every bank at once, reporting the progress of them all; each promise gives the
 * bank's bytes, or undefined for an optional bank that's missing.
 */
function download(banks: SoundBankSource[], onProgress?: (msg: string) => void): Promise<ArrayBuffer | undefined>[] {
  const got = banks.map(() => 0);
  const sizes = banks.map(() => 0);
  /** Whether each bank's size is known (or it's missing, so it doesn't count). */
  const known = banks.map(() => false);
  const report = () => {
    const total = sizes.reduce((a, b) => a + b, 0);
    const done = got.reduce((a, b) => a + b, 0);
    // A no-break space keeps the number with its unit when the status wraps.
    onProgress?.(known.every(Boolean) && total ? `Loading sounds… ${Math.floor((100 * done) / total)}%` : `Loading sounds… ${Math.round(done / 1e6)}\u00a0MB`);
  };
  return banks.map(async (bank, i) => {
    try {
      const res = await fetch(bank.url);
      // A missing file in dev comes back as the app's HTML page.
      if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`${bank.url} not found`);
      sizes[i] = Number(res.headers.get('content-length')) || 0;
      known[i] = sizes[i] > 0;
      if (!res.body) return await res.arrayBuffer();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        chunks.push(r.value);
        got[i] += r.value.length;
        report();
      }
      const out = new Uint8Array(got[i]);
      let at = 0;
      for (const c of chunks) out.set(c, (at += c.length) - c.length);
      return out.buffer;
    } catch (e) {
      if (!bank.optional) throw e;
      console.warn(`Skipping sound bank ${bank.id}:`, e);
      sizes[i] = got[i] = 0;
      known[i] = true;
      return undefined;
    }
  });
}
