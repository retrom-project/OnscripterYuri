#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
output=${1:?output directory is required}
mkdir -p "$output"
output=$(cd "$output" && pwd)

docker run --rm \
  --platform linux/amd64 \
  --hostname rpg-runtime-ons \
  --user "$(id -u):$(id -g)" \
  --env EMSDK_HOME=/emsdk \
  --env EMSDK_QUIET=1 \
  --env HOME=/tmp/ons-home \
  --volume "$root:/source" \
  --workdir /source/script \
  emscripten/emsdk@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06 \
  bash -c 'mkdir -p "$HOME" /source/build_web && export EMSDK_HOME=/emsdk && BUILD_TYPE=MinSizeRel TARGETS=all bash -e -o pipefail ./cross_web.sh'

install -m 0644 "$root/build_web/onsyuri.js" "$output/onsyuri.js"
install -m 0644 "$root/build_web/onsyuri.wasm" "$output/onsyuri.wasm"
install -m 0644 "$root/src/onsyuri/COPYING" "$output/COPYING"
