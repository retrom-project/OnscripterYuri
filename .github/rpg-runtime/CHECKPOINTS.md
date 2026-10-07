# Browser checkpoint boundary

The `ons-save` host ABI exports `_onsyuri_host_checkpoint_ready()` in addition to
startup readiness. Startup readiness only means that the engine has begun
executing the project. It does not imply that its current script state can be
captured.

A host checkpoint is available at a suspended manual dialogue wait: the default
text `@` / page wait, or a native `click` / `lrclick` inside a `textgosub`
continuation. Native menus, typewriter timers, transitions, automatic progression,
and pending rendering are busy. The runtime must expose that busy state to the
user. `_onsyuri_host_save(slot)` checks the same native condition synchronously
again and returns `-1` without overwriting the slot when it is busy.

Host files serialize the current native state and its suspended text wait. The
`WTXT` tail contains the wait kind, text offset, click mode, font cursor, page and
line state, native save flags, nested `textgosub` flags, and current text page.
Restore requires this tail and bounds it against the actual bytes read, rather
than the retained parser buffer capacity. A truncated tail is rejected. The host
sets the restore slot before `callMain`; it must not replace an active Asyncify
script stack by calling the load export during execution.

Ordinary game save/load slots retain their native savepoint behavior. Host
serialization does not overwrite the cached ordinary savepoint. Native load
callbacks still run for ordinary slots; a host continuation resumes its saved
wait directly.

## Reproduce browser regression tests

Build with `.github/rpg-runtime/build-candidate.sh <existing-empty-output>`.
Validate source with `python3 .github/rpg-runtime/verify-source.py`. Supply an
explicit font, Playwright 1.61.1 module, and Chromium executable:

```sh
node .github/rpg-runtime/checkpoint-browser.mjs \
  /absolute/candidate /absolute/DejaVuSans.ttf \
  /absolute/node_modules/playwright/index.mjs \
  /absolute/chromium /absolute/empty-default-evidence
ONS_TEXTGOSUB=1 node .github/rpg-runtime/checkpoint-browser.mjs \
  /absolute/candidate /absolute/DejaVuSans.ttf \
  /absolute/node_modules/playwright/index.mjs \
  /absolute/chromium /absolute/empty-textgosub-evidence
```

The authored MIT fixtures exercise third-wait capture, restore in another engine
instance, seven seconds without progression, and input continuing to the fourth
wait. The tests compare the rendered background, reject transition capture
without overwriting the previous checkpoint, load a short checkpoint after a
larger native parser allocation, and reject a truncated tail. The default wait
fixture also saves and loads through the ordinary native menu to prove that its
first-wait savepoint survives host capture at the third wait. Reports record the
actual JS, WASM, font, and fixture hashes. They do not prove all private projects,
video callbacks, or script-specific asynchronous extensions are resumable.

The custom fixture also compares its fourth-wait rendering with the original
instance after ordinary input. Its background must match exactly. Native direct
glyph drawing and cached text recomposition round integer alpha at different
stages; the full canvas comparison allows at most two color levels per channel
and records both hashes, the changed pixel count, and the maximum difference.
It does not claim identical text antialiasing pixels.
