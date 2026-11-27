#!/usr/bin/env bash
# Makes one Network Server's kit folder + zip: the plugin, its logo pack and the install guide.
#   ./make_kit.sh --name "Retro Realm" [--logo their_logo.png] [--pixel] [--out dir]
# The setup file (config.json, with the server's private token) is NOT in the kit: copy it from Control Panel > Join requests >
# Partners > Network Servers and send it to them privately.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name=""; logo=""; pixel=""; out="$here/kits"
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift 2;;
    --logo) logo="$2"; shift 2;;
    --pixel) pixel="--pixel"; shift;;
    --out) out="$2"; shift 2;;
    *) echo "unknown option $1"; exit 1;;
  esac
done
: "${name:?--name "Server Name" is needed}"
slug="$(printf '%s' "$name" | sed -E 's/[^A-Za-z0-9]+/_/g; s/^_+|_+$//g')"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
kit="$work/${slug}_GalaxySMP_Network_Kit"
mkdir -p "$kit" "$out"
"$here/build.sh" "$work/wheel" >/dev/null
cp "$work"/wheel/endstone_galaxylink_partner-*.whl "$kit/"
python3 "$here/logo-pack/build_logo_pack.py" --name "$name" ${logo:+--logo "$logo"} $pixel --out "$kit" --preview "$out/${slug}_logo_mockup.png" >/dev/null
sed "s/{{SERVER}}/$name/g; s/{{PACK}}/${slug}_Network_Logo.mcpack/g" "$here/KIT_GUIDE.txt" > "$kit/README_START_HERE.txt"
(cd "$work" && python3 -c "
import shutil, sys
shutil.make_archive(sys.argv[1], 'zip', '.', sys.argv[2])" "$out/${slug}_GalaxySMP_Network_Kit" "${slug}_GalaxySMP_Network_Kit")
ls -la "$out/${slug}_GalaxySMP_Network_Kit.zip" "$out/${slug}_logo_mockup.png"
