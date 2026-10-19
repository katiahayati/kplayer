"""Align a recording to a score, note by note.

Uses synctoolbox's memory-restricted multiscale DTW on chroma + onset (DLNCO)
features. The score side is synthesized from the notes exported by
scripts/export-score.ts, laid out at 60 quarter notes per minute, so a score
position q (in quarter notes) is q seconds of "score time".

Usage:
  .venv/bin/python tools/align_recording.py score-notes.json recording.webm alignment.json

Writes, for every distinct note onset in the score, the time it happens in the
recording, plus the key shift and tuning that were detected.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import soundfile as sf
from synctoolbox.dtw.mrmsdtw import sync_via_mrmsdtw
from synctoolbox.dtw.utils import compute_optimal_chroma_shift, make_path_strictly_monotonic, shift_chroma_vectors
from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma, quantized_chroma_to_CENS
from synctoolbox.feature.csv_tools import df_to_pitch_features, df_to_pitch_onset_features
from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
from synctoolbox.feature.pitch import audio_to_pitch_features
from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features
from synctoolbox.feature.utils import estimate_tuning

FS = 22050
FEATURE_RATE = 50  # frames per second
STEP_WEIGHTS = np.array([1.5, 1.5, 2.0])
THRESHOLD_REC = 10**6  # bounds the DTW matrix size per level (memory)


def decode(path: Path) -> np.ndarray:
    """Decode any audio/video file to mono 22.05 kHz with ffmpeg, streaming to a temp WAV."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(FS), "-c:a", "pcm_s16le", str(wav)],
            check=True,
        )
        audio, _ = sf.read(wav, dtype="float32")
    return audio


def trim_silence(audio: np.ndarray, threshold_db: float = -60.0) -> tuple[np.ndarray, float]:
    """Crops what comes before and after the music. Recordings often start with seconds of
    digital silence, then room noise or hiss, before the first chord; either would otherwise be
    stretched over the first bars. Returns the cropped audio and the start offset."""
    hop = FS // 20  # 50 ms
    frames = len(audio) // hop
    level = 20 * np.log10(np.sqrt(np.mean(audio[: frames * hop].reshape(frames, hop) ** 2, axis=1)) + 1e-9)
    loud = np.nonzero(level > threshold_db)[0]
    if not len(loud):
        return audio, 0.0
    first, last = loud[0], loud[-1]

    # Noise before the music: if the first two seconds after the silence sit far below the
    # piece's typical level, the music has surely started once the level stays 10 dB above that
    # floor for a second; it began where that rise first left the floor (3 dB above it).
    smooth = np.convolve(level, np.ones(10) / 10, mode="same")  # 0.5 s
    floor = np.median(smooth[first : first + 40])
    typical = np.median(smooth[first : last + 1])
    if typical - floor > 15:
        above = smooth[first : last + 1] > floor + 10
        held = np.convolve(above, np.ones(20), mode="valid") == 20  # a full second above
        if held.any():
            sure = first + int(np.argmax(held))
            while sure > first and level[sure - 1] > floor + 3:
                sure -= 1
            first = sure

    start = max(0, first * hop - FS // 4)
    end = min(len(audio), (last + 1) * hop + FS // 2)
    return audio[start:end], start / FS


def score_features(notes: list[dict], layout):
    """Score features with notes laid out in time by `layout` (score position -> seconds)."""
    on = layout(np.array([n["qOn"] for n in notes]))
    off = layout(np.array([n["qOff"] for n in notes]))
    df = pd.DataFrame(
        {
            "start": on,
            "duration": np.maximum(off - on, 0.05),
            "pitch": [n["pitch"] for n in notes],
            "velocity": [0.7] * len(notes),
            "instrument": [str(n["part"]) for n in notes],
        }
    )
    chroma = quantize_chroma(pitch_to_chroma(df_to_pitch_features(df, feature_rate=FEATURE_RATE)))
    onsets = df_to_pitch_onset_features(df)
    dlnco = pitch_onset_features_to_DLNCO(
        f_peaks=onsets, feature_rate=FEATURE_RATE, feature_sequence_length=chroma.shape[1], visualize=False
    )
    return chroma, dlnco


def audio_features(audio: np.ndarray):
    tuning = estimate_tuning(audio, FS)
    pitch = audio_to_pitch_features(f_audio=audio, Fs=FS, tuning_offset=tuning, feature_rate=FEATURE_RATE, verbose=False)
    chroma = quantize_chroma(pitch_to_chroma(f_pitch=pitch))
    onsets = audio_to_pitch_onset_features(f_audio=audio, Fs=FS, tuning_offset=tuning, verbose=False)
    dlnco = pitch_onset_features_to_DLNCO(
        f_peaks=onsets, feature_rate=FEATURE_RATE, feature_sequence_length=chroma.shape[1], visualize=False
    )
    return chroma, dlnco, tuning


def align(a_chroma, a_dlnco, s_chroma, s_dlnco) -> tuple[np.ndarray, np.ndarray]:
    """DTW path as (audio seconds, score seconds), strictly monotonic."""
    wp = sync_via_mrmsdtw(
        f_chroma1=a_chroma,
        f_onset1=a_dlnco,
        f_chroma2=s_chroma,
        f_onset2=s_dlnco,
        input_feature_rate=FEATURE_RATE,
        step_weights=STEP_WEIGHTS,
        threshold_rec=THRESHOLD_REC,
        verbose=False,
    )
    wp = make_path_strictly_monotonic(wp)
    return wp[0] / FEATURE_RATE, wp[1] / FEATURE_RATE


def smooth_layout(q_grid: np.ndarray, t_grid: np.ndarray, half_window: float = 8.0):
    """A smooth score layout from a first alignment: local seconds-per-quarter measured over
    ±half_window quarter notes, integrated. Where the score gives the aligner little to go on
    (long held chords), the second pass then follows this curve instead of a flat tempo."""
    lo = np.interp(q_grid - half_window, q_grid, t_grid)
    hi = np.interp(q_grid + half_window, q_grid, t_grid)
    span = np.minimum(q_grid + half_window, q_grid[-1]) - np.maximum(q_grid - half_window, q_grid[0])
    spq = np.clip((hi - lo) / np.maximum(span, 1e-9), 0.25, 3.0)
    times = np.concatenate([[0.0], np.cumsum((spq[:-1] + spq[1:]) / 2 * np.diff(q_grid))])
    return lambda q: np.interp(q, q_grid, times)


def main(notes_path: str, audio_path: str, out_path: str) -> None:
    score = json.loads(Path(notes_path).read_text())
    notes = score["notes"]
    audio, offset = trim_silence(decode(Path(audio_path)))
    print(f"audio: {len(audio) / FS:.1f} s of music, starting at {offset:.2f} s", file=sys.stderr)

    a_chroma, a_dlnco, tuning = audio_features(audio)
    del audio

    # Pass 1: the score laid out at 1 s per quarter note.
    flat = lambda q: np.asarray(q, dtype=float)
    s_chroma, s_dlnco = score_features(notes, flat)
    shift = compute_optimal_chroma_shift(
        quantized_chroma_to_CENS(a_chroma, 201, 50, FEATURE_RATE)[0],
        quantized_chroma_to_CENS(s_chroma, 201, 50, FEATURE_RATE)[0],
    )
    print(f"tuning offset {tuning} cents, key shift {shift} semitones", file=sys.stderr)
    audio_t, score_t = align(a_chroma, a_dlnco, shift_chroma_vectors(s_chroma, shift), shift_chroma_vectors(s_dlnco, shift))

    # Pass 2: the score laid out along a smoothed version of pass 1.
    q_grid = np.arange(0.0, score["endQ"] + 0.25, 0.25)
    layout = smooth_layout(q_grid, np.interp(q_grid, score_t, audio_t))
    s_chroma, s_dlnco = score_features(notes, layout)
    audio_t, score_t = align(a_chroma, a_dlnco, shift_chroma_vectors(s_chroma, shift), shift_chroma_vectors(s_dlnco, shift))

    onsets = sorted({round(n["qOn"], 6) for n in notes} | {score["endQ"]})
    times = np.interp(layout(np.array(onsets)), score_t, audio_t) + offset
    Path(out_path).write_text(
        json.dumps(
            {
                "score": {"name": score["name"], "sha256": score["sha256"]},
                "recording": Path(audio_path).name,
                "tuningCents": float(tuning),
                "keyShift": int(shift),
                "musicStart": round(offset, 3),
                "onsets": [[q, round(float(t), 4)] for q, t in zip(onsets, times)],
            }
        )
    )
    print(f"wrote {len(onsets)} aligned onsets to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
