#!/usr/bin/env bash
set -euo pipefail
port=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname -- "$port")
out="$port/out"
if [[ ! -f "$root/vendor/librw/src/rwbase.h" ]]; then
    echo "Initialize librw first: git submodule update --init vendor/librw" >&2
    exit 1
fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cd "$work"
mkdir re3 librw generated
cp -a "$root/src" re3/
rm -f re3/src/extras/GitSHA1.cpp
revision=$(git -C "$root" rev-parse HEAD)
sed "s/@GIT_SHA1@/$revision/" re3/src/extras/GitSHA1.cpp.in > generated/GitSHA1.cpp
# Apply the AVM2 changes to an isolated copy of the submodule recorded by re3.
librw=$(git -C "$root" rev-parse HEAD:vendor/librw)
git -C "$root/vendor/librw" archive "$librw" | tar -x -C librw
git -C librw apply "$port/librw.patch"
cp -a "$port/host" "$port/game.mk" "$port/librw.mk" "$port/sdk-game.sh" .
export CROSSBRIDGE_IMAGE=${CROSSBRIDGE_IMAGE:-ghcr.io/33tu/crossbridge@sha256:486ae832869e84cc25be62d3332ffffde64a8d42cd415f0a3346dddc5c98d84c}
crossbridge bash sdk-game.sh
mkdir -p "$out"
cp re3-game.swf "$port/app.xml" "$out/"
cp librw/LICENSE "$out/librw-LICENSE"
