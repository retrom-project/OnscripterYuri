# Browser command compatibility

The browser core implements the following legacy NScripter behavior through its
existing renderer, SDL mixer, content reader and event loop. No Retrom server or
private game input is required by the core.

- `checksp variable,sprite` reports whether a loaded sprite is visible and rejects
  an out-of-range sprite number. `getspmode` also checks its sprite index.
- `humanpos left,center,right` changes the horizontal character anchors used by
  `ld`, in script coordinates.
- `btnnowindowerase` keeps the displayed text during `btnwait` and `btnwait2`.
  `noteraseman` declares the character-retention behavior already provided by
  this renderer when the text window is hidden.
- `defbgmvol` and the observed `defvoicecol` spelling use the existing default
  music and voice volume commands. `dsound` accepts the old backend selection;
  the browser uses its initialized SDL audio backend.
- `bgmdownmode` halves music while voice channel 0 plays and restores the
  configured gain on completion or explicit stop. Music gain combines the
  configured volume, mute, ducking and existing fade envelope. `cdfadeout`
  applies to simulated CD tracks when stopping or changing tracks.
- `lookbackvoice` plays its configured sound on entering a nonempty history page
  and moving between history pages. It does not replay the story voice channel.
- `font "file.ttf"` and the observed one-string `setfont "file.ttf"` variant
  preserve an already drawn page and apply at the next page clear. `spfont`
  changes text-sprite rendering independently; `spfont clear` resets its override.
  Optional sprite parameters are width, height, horizontal and vertical spacing,
  bold and shadow. Explicit `:s/size,...` image tags retain their dimensions.
  Windows font-family names unavailable as project files fall back to the supplied
  startup font, with an explicit substitution diagnostic. This does not install
  or claim to reproduce the named Windows font.
- `resetmenu`, `insertmenu`, `deletemenu` and `killmenu` control a browser game
  menu. Actions are delivered through queued SDL events so menu callbacks do not
  reenter a suspended engine. The supported actions are `sub`, `end`, `reset`,
  `skip`, `auto`, `version`, `font`, `textslow`, `textmiddle`, `textfast`, `full`,
  `window`, `clickdef`, `clickpage`, `waveon`, `waveoff`, `dwavevolume`, `cdon`
  and `cdoff`. Font selection accepts a user-selected local font; fullscreen
  remains a browser user-gesture operation. Physical CD drive selection is not
  available in a browser.
- `mousecursor` reads a project CUR or ANI through the content reader and keeps
  the hotspot. ANI supports embedded CUR frames, sequence/rate tables and jiffy
  timing. The exact legacy RIFF-header overcount is accepted only when all inner
  chunks still fit the complete file. Invalid files are diagnosed and leave the
  original cursor. Exit clears animations, menus, dialogs and cursor state.
- `errorsave` writes diagnostic native slot 999 and its companion before a fatal
  gameplay script error. A modal dialog offers both files before the engine
  exits. Startup errors without initialized gameplay state cannot be saved;
  failed diagnostic writes are reported without recursive error handling.

## Menu indexing

`killmenu` indexes the current top-level items, starting at zero, removes the
selected item and its descendants, and shifts subsequent indexes left. The
initial layout follows the legacy 2015/2018 NScripter executable menu resources:
Display, Font, Page display, Text speed, Sound, Skip, Auto, CD audio, Version,
Quit. Insertions occur at the beginning of the selected menu. The more recent
Windows menu layout is not substituted for this legacy index order.

## Native save state

Native `saveN.dat` and its `WTXT` host continuation retain their existing layout.
A private `saveN.compat` companion records command configuration, text and
creation-time sprite fonts, menu structure and insertion parents, cursor,
audio settings and text speed. It is bound to the native slot's length and CRC32;
malformed or mismatched companions fail restoration. Original native saves
without companion files remain readable. Ordinary saves use the same captured
savepoint as the native file; host saves capture the actual stable text wait.
The caller must retain the complete native save directory, including selected
font files. The existing browser adapter already packages that directory.

## Verification

Run the authored browser suite against the candidate's actual JavaScript/Wasm:

```sh
node .github/rpg-runtime/compatibility-browser.mjs \
  /absolute/candidate /absolute/DejaVuSans.ttf /absolute/DejaVuSerif.ttf \
  /absolute/playwright/index.mjs /absolute/chrome /absolute/new-evidence
```

The fixtures assert rendered pixels and input effects, real mixed audio output,
menu operations, CUR/ANI rendering and cleanup, downloadable error saves and
fresh-instance restoration including rejected companion bindings. `ONS_CASES`
can select comma-separated cases. Keep the existing `checkpoint-browser.mjs`
regressions for both default waits and `ONS_TEXTGOSUB=1` as well.

Behavior references: the [official NScripter distribution](https://www.nscripter.com/),
[ONScripter-EN](https://github.com/Galladite27/ONScripter-EN/tree/3854ae86c19337991722059d2bed07cbcc847f6f),
and the [Microsoft RIFF ANI specification](https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/Docs/RIFFNEW.pdf).
