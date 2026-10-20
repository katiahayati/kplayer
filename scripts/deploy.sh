#!/usr/bin/env bash
# Builds kplayer and uploads it to a static web host with rsync over ssh.
#
#   npm run deploy                 build, then upload
#   npm run deploy -- --dry-run    build, then show what would change without uploading
#
# The target is KPLAYER_DEPLOY (an rsync destination, host:path), by default kplayer's
# folder on katiahayati.com. rsync --delete removes whatever in the target isn't in the
# build, so the target must be a folder of its own, never a site's root.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${KPLAYER_DEPLOY:-katiahayati.com:katiahayati.com/kplayer/}"
host="${target%%:*}"
path="${target#*:}"
path="${path%/}"
if [[ "$target" != *:* || -z "$host" || -z "$path" || "$path" != */* || "$path" == /* || "$path" == *..* ]]; then
  echo "Refusing to deploy to '$target': give host:site-folder/app-folder, e.g. example.com:example.com/kplayer/" >&2
  exit 1
fi

for bank in MuseScore_General.sf3 YDP-GrandPiano.sf2; do
  if [[ ! -f "public/soundfonts/$bank" ]]; then
    echo "public/soundfonts/$bank is missing: run npm run fetch-soundfont first." >&2
    exit 1
  fi
done

npm run build
rsync -av --delete "$@" dist/ "$host:$path/"
