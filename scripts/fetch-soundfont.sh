#!/usr/bin/env bash
# Downloads the MuseScore General SoundFont (MIT licensed) into public/soundfonts/.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/public/soundfonts"
url="https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3"
mkdir -p "$dir"
if [[ -f "$dir/MuseScore_General.sf3" ]]; then
  echo "Already present: $dir/MuseScore_General.sf3"
  exit 0
fi
echo "Downloading $url"
curl -fL --progress-bar -o "$dir/MuseScore_General.sf3.part" "$url"
mv "$dir/MuseScore_General.sf3.part" "$dir/MuseScore_General.sf3"
echo "Saved to $dir/MuseScore_General.sf3"
