// Offline rendering through the same SoundFont synth as the app (SpessaSynth),
// with the app's banks: the YDP piano first, MuseScore General for the rest.

import fs from 'node:fs';
import path from 'node:path';
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer, type BasicSoundBank } from 'spessasynth_core';

const BANKS = ['YDP-GrandPiano.sf2', 'MuseScore_General.sf3'];

export interface Renderer {
  rate: number;
  /** Renders a performance MIDI (kplayer's flat-time MIDI) to stereo audio of `seconds` length. */
  render(midi: Uint8Array, seconds: number): Promise<{ left: Float32Array; right: Float32Array }>;
}

/**
 * Loads the banks once; each render starts a fresh synth. With `pianoOnly`, just the piano bank, which
 * saves memory (the General MIDI bank decodes to far more than its file size).
 */
export function createRenderer(rate = 44100, { pianoOnly = false, dir = 'public/soundfonts' } = {}): Renderer {
  const banks: BasicSoundBank[] = (pianoOnly ? BANKS.slice(0, 1) : BANKS)
    .map((f) => path.join(dir, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => {
      const b = fs.readFileSync(f);
      return SoundBankLoader.fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    });
  return {
    rate,
    async render(midiBytes, seconds) {
      const synth = new SpessaSynthProcessor(rate, { eventsEnabled: false });
      banks.forEach((b, i) => synth.soundBankManager.addSoundBank(b, `bank${i}`));
      synth.soundBankManager.priorityOrder = banks.map((_, i) => `bank${i}`);
      await synth.processorInitialized;
      synth.setSystemParameter('autoAllocateVoices', true);
      const seq = new SpessaSynthSequencer(synth);
      // As the app: time 0 is the start of the score, even when the first notes come later.
      // (Set before loading: the sequencer skips ahead as it loads the song.)
      seq.skipToFirstNoteOn = false;
      seq.loopCount = 0;
      seq.loadNewSongList([BasicMIDI.fromArrayBuffer(midiBytes.buffer.slice(midiBytes.byteOffset, midiBytes.byteOffset + midiBytes.byteLength) as ArrayBuffer)]);
      seq.play();
      const total = Math.ceil(rate * seconds);
      const left = new Float32Array(total);
      const right = new Float32Array(total);
      for (let done = 0; done < total; done += 128) {
        seq.processTick();
        synth.process(left, right, done, Math.min(128, total - done));
      }
      return { left, right };
    },
  };
}
