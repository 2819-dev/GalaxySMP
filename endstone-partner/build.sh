#!/usr/bin/env bash
# Builds the GalaxySMP Network plugin (.whl). It contains no secret: each server's own token lives in its config.json.
# Usage: ./build.sh [output-dir]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/dist}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -r "$here/pyproject.toml" "$here/src" "$work/"
mkdir -p "$out"
python3 -m pip wheel "$work" --no-deps --quiet --wheel-dir "$out"
ls "$out"/endstone_galaxylink_partner-*.whl
