#!/usr/bin/env python3
"""Validate the fixed ONScripterYuri fork baseline and host bridge."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BASELINE = "08f744b31cc1907b66a15f0402e62321a131ed81"


def require(path: str, markers: tuple[str, ...]) -> None:
    text = (ROOT / path).read_text(encoding="utf-8")
    if any(marker not in text for marker in markers):
        raise SystemExit(f"RPG_RUNTIME_SOURCE_CONTRACT_INVALID:{path}")


def main() -> int:
    manifest = json.loads((ROOT / "retrom-fork.json").read_text(encoding="utf-8"))
    expected = {
        "schemaVersion": 1,
        "forkRepository": "https://github.com/xxxsen/OnscripterYuri",
        "defaultBranch": "retrom/0.7.7beta",
        "upstreamMirrorBranch": "master",
        "upstreams": [
            {
                "role": "engine",
                "repository": "https://github.com/YuriSizuku/OnscripterYuri",
                "refType": "TAG",
                "ref": "v0.7.7beta",
                "commit": BASELINE,
            }
        ],
        "releaseTagPattern": (
            r"^rpg-runtime-0\.7\.7beta-r[1-9][0-9]*"
            r"(-rc\.[1-9][0-9]*)?$"
        ),
        "adapterAbi": "ons-save",
        "releaseAssets": [
            "onsyuri.js", "onsyuri.wasm", "COPYING",
            "rpg-runtime-release.json",
        ],
    }
    if manifest != expected:
        raise SystemExit("RPG_RUNTIME_FORK_MANIFEST_INVALID")
    require("src/onsyuri/ONScripter.h", (
        "saveGameForHost", "loadGameForHost", "setHostPaused",
        "setHostRestoreSlot", "applyHostRestore", "isHostReady",
    ))
    require("src/onsyuri/ONScripter_command.cpp", (
        "ONScripter::saveGameForHost", "ONScripter::loadGameForHost",
        "applyHostRestore();",
    ))
    require("src/onsyuri/onscripter_main.cpp", (
        "onsyuri_host_save", "onsyuri_host_load", "onsyuri_host_set_paused",
        "onsyuri_host_is_ready", "onsyuri_host_did_restore_fail",
        "onsyuri_host_set_restore_slot", "onsyuriHostReady",
    ))
    require("src/onsyuri/ONScripter_event.cpp", (
        "while ( host_paused ) SDL_Delay(10);", "mouseOverCheck(x, y);",
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
