#!/usr/bin/env bash
# Builds the GalaxyLink Endstone plugin (.whl) with the website secret baked in.
# Usage: PLUGIN_SECRET=... ./build.sh [output-dir]
# The secret is written into a temporary copy only, never into the repository.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/dist}"
: "${PLUGIN_SECRET:?Set PLUGIN_SECRET to the value stored in Cloudflare}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -r "$here/pyproject.toml" "$here/src" "$work/"
python3 - "$work/src/endstone_galaxylink/settings.py" <<'PY'
import os, sys
path = sys.argv[1]
text = open(path).read().replace("PASTE_PLUGIN_SECRET_HERE", os.environ["PLUGIN_SECRET"])
open(path, "w").write(text)
PY
mkdir -p "$out"
python3 -m pip wheel "$work" --no-deps --quiet --wheel-dir "$out"
ls "$out"/endstone_galaxylink-*.whl
