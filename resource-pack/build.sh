#!/usr/bin/env bash
# Builds the GalaxySMP add-on packs from resource-pack/src and behavior-pack/src:
#   GalaxySMP_Voice_Icons.mcpack  - resource pack: voice/rank icons, logo, Minigame Computer model
#   GalaxySMP_Blocks.mcpack       - behavior pack: the Minigame Computer block (galaxysmp:computer)
# Usage: resource-pack/build.sh /absolute/output/dir
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/dist}"
mkdir -p "$out"
pack() {  # pack <source dir> <output file>
  python3 - "$1" "$2" <<'PY'
import os, sys, zipfile
src, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            if f.endswith("_preview.png"):
                continue
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, src))
PY
}
pack "$here/src" "$out/GalaxySMP_Voice_Icons.mcpack"
pack "$here/../behavior-pack/src" "$out/GalaxySMP_Blocks.mcpack"
ls -la "$out/GalaxySMP_Voice_Icons.mcpack" "$out/GalaxySMP_Blocks.mcpack"
