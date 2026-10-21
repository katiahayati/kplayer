#!/usr/bin/env bash
# Gets the sound banks into public/soundfonts/:
#   - MuseScore General (MIT): every General MIDI instrument
#   - Salamander Grand Piano (Alexander Holm, CC-BY 3.0): a Yamaha C5 recorded in stereo at
#     16 strike strengths, which replaces the piano. It's built here from the original release
#     by scripts/build-piano.ts, which needs ffmpeg with libvorbis.
# Downloads are streamed to disk, never held in memory. Set SALAMANDER_ARCHIVE to a copy of
# SalamanderGrandPianoV3_44.1khz16bit.tar.bz2 you already have to skip that download (489 MB).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/public/soundfonts"
mkdir -p "$dir"

general="$dir/MuseScore_General.sf3"
if [[ -f "$general" ]]; then
  echo "Already present: $general"
else
  echo "Downloading MuseScore General (~40 MB)…"
  curl -fL --progress-bar -o "$general.part" \
    "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3"
  mv "$general.part" "$general"
fi

piano="$dir/SalamanderGrandPiano.sf3"
if [[ -f "$piano" ]]; then
  echo "Already present: $piano"
else
  if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libvorbis; then
    echo "Building the piano needs ffmpeg with libvorbis (e.g. sudo apt install ffmpeg)." >&2
    exit 1
  fi
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  archive="${SALAMANDER_ARCHIVE:-}"
  if [[ -z "$archive" ]]; then
    echo "Downloading the Salamander Grand Piano recordings (~490 MB)…"
    archive="$tmp/salamander.tar.bz2"
    curl -fL --progress-bar -o "$archive" \
      "https://archive.org/download/SalamanderGrandPianoV3/SalamanderGrandPianoV3_44.1khz16bit.tar.bz2"
  fi
  echo "Unpacking the notes (~1.1 GB, removed afterwards)…"
  tar -xjf "$archive" -C "$tmp" --strip-components=1 --wildcards '*/SalamanderGrandPianoV3.sfz' '*v[0-9]*.wav'
  echo "Building the piano (a few minutes)…"
  (cd "$root" && npx tsx scripts/build-piano.ts "$tmp" "$piano.part")
  mv "$piano.part" "$piano"
fi
echo "Sound banks are in $dir"
