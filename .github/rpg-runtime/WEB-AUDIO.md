# Web audio output

The Web build uses SDL2_mixer's decoders and browser AudioBufferSourceNodes for
independent voice, effect and music playback. Script, text rendering and image
decoding no longer have to refill an audible ScriptProcessor buffer. Replacing
replayed buffers with an underrun-silence queue alone is insufficient: the same
main-thread stalls then cause audible gaps. Both replay and gaps are regressions.

The Web-only SDL playback facade lives in `ons_audio_web.h/.cpp`; native builds
retain SDL playback. PCM conversion still uses the pinned SDL decoder set,
including Ogg, MP3 and MIDI. PCM is copied into a browser-owned stereo buffer;
temporary native music PCM is released after the copy. Assets remain owned by
their native music/chunk handles. Decoded buffers have a 256 MiB per-clip and
512 MiB total budget; allocation failure is reported through Mix_GetError.
Music is decoded ahead of playback, with higher startup work/memory than a
streaming decoder. Existing voices and music keep playing during that work.

Sources preserve channel volumes, local/host pause, remaining duration, seek,
finite/infinite looping, loop-start offset, fade deadlines and native completion
callbacks. Intro-to-loop BGM handoff is scheduled on the audio clock before
the intro ends; a delayed native completion event cannot restart the loop.
Replacing/freeing a clip detaches its old completion callback; an
old event cannot finish a replacement voice. Host pause retains position;
native load/reset stop previous sources. Exit, abort and device reopen stop
sources and release all browser buffers and nodes. The backend is embedded into
onsyuri.js, with no extra release asset or cross-origin isolation requirement.

Run `node --test .github/rpg-runtime/audio.test.mjs` for PCM ownership, stereo,
channel replacement, local/host pause, looping, seeking, volume, fades,
allocation limits, reset and cleanup. The existing
`compatibility-browser.mjs` also runs `audio-underrun` against the compiled
core: it plays an authored non-repeating stereo signal, injects three 350 ms
main-thread stalls, captures actual destination audio and rejects replayed
512-frame windows at the old two-buffer delay and silent gaps of 20 ms or more.
It additionally checks that
pause and exit are silent and resume becomes audible. `ONS_CASES=audio-underrun`
selects this case alone; the workflow runs it with the complete compatibility
suite, including voice/music gain, native state restore and script input.
