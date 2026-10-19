#!/usr/bin/env bash
# Downloads the sound banks into public/soundfonts/:
#   - MuseScore General (MIT): every General MIDI instrument
#   - YDP Grand Piano (FreePats, CC-BY 3.0): a sampled Yamaha grand that replaces the piano
# Archives are streamed straight to disk, never held in memory.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/public/soundfonts"
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

piano="$dir/YDP-GrandPiano.sf2"
if [[ -f "$piano" ]]; then
  echo "Already present: $piano"
else
  echo "Downloading YDP Grand Piano (~37 MB, unpacks to ~118 MB)…"
  curl -fL --progress-bar "https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2" |
    tar -xjO YDP-GrandPiano-SF2-20160804/YDP-GrandPiano-20160804.sf2 > "$piano.part"
  mv "$piano.part" "$piano"
fi
echo "Sound banks are in $dir"
