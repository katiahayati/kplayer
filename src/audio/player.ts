// Thin wrapper over SpessaSynth: a SoundFont synth plus its MIDI sequencer.
// The app hands it finished performance MIDI files (already expressively timed)
// and reads back the playback position in performance seconds.

import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export interface LoadOptions {
  /** Performance time the file's tick 0 corresponds to (non-zero for loop windows). */
  offset?: number;
  loop?: boolean;
  /** Performance time to start from. */
  at?: number;
  play?: boolean;
}

export class Player {
  private offset = 0;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly seq: Sequencer,
  ) {}

  static async create(soundFontUrl: string, onProgress?: (msg: string) => void): Promise<Player> {
    const ctx = new AudioContext();
    onProgress?.('Starting audio…');
    await ctx.audioWorklet.addModule(processorUrl);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(ctx.destination);
    onProgress?.('Loading sounds…');
    const font = await (await fetch(soundFontUrl)).arrayBuffer();
    await synth.soundBankManager.addSoundBank(font, 'main');
    await synth.isReady;
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    return new Player(ctx, seq);
  }

  /** Replaces what's playing, keeping play/pause state unless told otherwise. */
  load(midi: Uint8Array, opts: LoadOptions = {}): void {
    const wasPlaying = !this.seq.paused;
    this.offset = opts.offset ?? 0;
    const binary = midi.slice().buffer as ArrayBuffer;
    this.seq.loadNewSongList([{ binary, fileName: 'performance.mid' }]);
    this.seq.loopCount = opts.loop ? Infinity : 0;
    this.seq.currentTime = Math.max(0, (opts.at ?? this.offset) - this.offset);
    if (opts.play ?? wasPlaying) this.play();
    else this.seq.pause();
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

  /** Smoothed playback position in performance seconds. */
  get time(): number {
    return this.offset + this.seq.currentHighResolutionTime;
  }

  seek(t: number): void {
    this.seq.currentTime = Math.max(0, t - this.offset);
  }
}
