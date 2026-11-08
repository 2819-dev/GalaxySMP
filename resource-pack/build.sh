#!/usr/bin/env bash
# Builds GalaxySMP_Voice_Icons.mcpack from resource-pack/src.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/dist}"
mkdir -p "$out"
rm -f "$out/GalaxySMP_Voice_Icons.mcpack"
(cd "$here/src" && python3 -m zipfile -c "$out/GalaxySMP_Voice_Icons.mcpack" manifest.json pack_icon.png font)
ls -la "$out/GalaxySMP_Voice_Icons.mcpack"
