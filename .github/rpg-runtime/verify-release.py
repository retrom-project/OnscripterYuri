#!/usr/bin/env python3
"""Validate ONScripterYuri browser assets and emit release metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


TAG = re.compile(r"^retrom-core-0\.7\.7beta-r[1-9][0-9]*(-rc\.[1-9][0-9]*)?$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    if TAG.fullmatch(args.tag) is None or COMMIT.fullmatch(args.commit) is None:
        raise SystemExit("RPG_RUNTIME_RELEASE_IDENTITY_INVALID")

    js_path = args.output / "onsyuri.js"
    wasm_path = args.output / "onsyuri.wasm"
    license_path = args.output / "COPYING"
    if js_path.is_symlink() or not js_path.is_file() or js_path.stat().st_size < 150_000:
        raise SystemExit("RPG_RUNTIME_RELEASE_JS_INVALID")
    if wasm_path.is_symlink() or not wasm_path.is_file() or wasm_path.stat().st_size < 4_000_000:
        raise SystemExit("RPG_RUNTIME_RELEASE_WASM_INVALID")
    if wasm_path.read_bytes()[:8] != b"\x00asm\x01\x00\x00\x00":
        raise SystemExit("RPG_RUNTIME_RELEASE_WASM_INVALID")
    if license_path.is_symlink() or not license_path.is_file() or license_path.stat().st_size < 10_000:
        raise SystemExit("RPG_RUNTIME_RELEASE_LICENSE_INVALID")
    javascript = js_path.read_text(encoding="utf-8")
    if any(marker not in javascript for marker in (
        "_onsyuri_host_save", "_onsyuri_host_load", "_onsyuri_host_set_paused",
        "_onsyuri_host_is_ready", "_onsyuri_host_set_restore_slot",
    )):
        raise SystemExit("RPG_RUNTIME_RELEASE_BRIDGE_INVALID")

    assets = [
        {"filename": path.name, "observedSha256": digest(path), "sizeBytes": path.stat().st_size}
        for path in (js_path, wasm_path, license_path)
    ]
    metadata = {
        "adapterAbi": "ons-save",
        "assets": assets,
        "commit": args.commit,
        "digestPolicy": "OBSERVED_CACHE_INTEGRITY_ONLY",
        "repository": args.repository,
        "schemaVersion": 1,
        "sourceCommits": {"engine": "08f744b31cc1907b66a15f0402e62321a131ed81"},
        "tag": args.tag,
    }
    (args.output / "rpg-runtime-release.json").write_text(
        json.dumps(metadata, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
