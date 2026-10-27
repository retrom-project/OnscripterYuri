// SPDX-License-Identifier: GPL-2.0-or-later
#ifdef WEB
#define ONS_AUDIO_WEB_IMPLEMENTATION
#include "ons_audio_web.h"
#include <emscripten.h>

namespace {
struct WebMusic {};
void (*channel_finished)(int) = nullptr;
void (*music_finished)() = nullptr;

bool register_pcm(const char *kind, const void *id, Mix_Chunk *chunk)
{
    int rate, channels;
    Uint16 format;
    if (!Mix_QuerySpec(&rate, &format, &channels) || format != AUDIO_S16SYS) return false;
    const int result = EM_ASM_INT({
        return Module['onsAudio']['load'](UTF8ToString($0) + $1, $2, $3, $4, $5);
    }, kind, id, chunk->abuf, chunk->alen, rate, channels);
    if (!result) Mix_SetError("Web audio clip exceeds its decoded-memory budget or cannot be allocated");
    return result != 0;
}
}

extern "C" EMSCRIPTEN_KEEPALIVE void ons_web_audio_finished(int channel)
{
    if (channel == -1) { if (music_finished) music_finished(); }
    else if (channel_finished) channel_finished(channel);
}

Mix_Chunk *ons_web_load_wav(SDL_RWops *src, int free_src)
{
    Mix_Chunk *chunk = Mix_LoadWAV_RW(src, free_src);
    if (chunk && !register_pcm("chunk:", chunk, chunk)) { Mix_FreeChunk(chunk); return nullptr; }
    return chunk;
}

void ons_web_free_chunk(Mix_Chunk *chunk)
{
    if (!chunk) return;
    EM_ASM({ Module['onsAudio']['release']('chunk:' + $0); }, chunk);
    Mix_FreeChunk(chunk);
}

Mix_Music *ons_web_load_music(SDL_RWops *src, int free_src)
{
    // Keep SDL's decoder set (including MIDI), but release native music PCM
    // after copying into the browser-owned playback buffer.
    Mix_Chunk *chunk = Mix_LoadWAV_RW(src, free_src);
    if (!chunk) return nullptr;
    WebMusic *music = new WebMusic;
    const bool loaded = register_pcm("music:", music, chunk);
    Mix_FreeChunk(chunk);
    if (!loaded) { delete music; return nullptr; }
    return reinterpret_cast<Mix_Music *>(music);
}

void ons_web_free_music(Mix_Music *music)
{
    if (!music) return;
    EM_ASM({ Module['onsAudio']['release']('music:' + $0); }, music);
    delete reinterpret_cast<WebMusic *>(music);
}

int ons_web_allocate_channels(int count)
{
    const int allocated = Mix_AllocateChannels(count);
    EM_ASM({ Module['onsAudio']['allocate']($0); }, allocated);
    return allocated;
}

int ons_web_play_channel(int channel, Mix_Chunk *chunk, int loops)
{
    return EM_ASM_INT({ return Module['onsAudio']['play']($0, 'chunk:' + $1, $2); }, channel, chunk, loops);
}
int ons_web_play_music(Mix_Music *music, int loops)
{
    return EM_ASM_INT({ return Module['onsAudio']['play']('music', 'music:' + $0, $1); }, music, loops);
}
int ons_web_playing(int channel) { return EM_ASM_INT({ return Module['onsAudio']['playing']($0); }, channel); }
int ons_web_playing_music() { return EM_ASM_INT({ return Module['onsAudio']['playing']('music'); }); }
int ons_web_volume(int channel, int value) { return EM_ASM_INT({ return Module['onsAudio']['volume']($0, $1); }, channel, value); }
int ons_web_music_volume(int value) { return EM_ASM_INT({ return Module['onsAudio']['volume']('music', $0); }, value); }
void ons_web_pause(int channel) { EM_ASM({ Module['onsAudio']['pause']($0, true); }, channel); }
void ons_web_resume(int channel) { EM_ASM({ Module['onsAudio']['pause']($0, false); }, channel); }
void ons_web_pause_music() { EM_ASM({ Module['onsAudio']['pause']('music', true); }); }
void ons_web_resume_music() { EM_ASM({ Module['onsAudio']['pause']('music', false); }); }
int ons_web_halt_music() { EM_ASM({ Module['onsAudio']['halt']('music'); }); return 0; }
int ons_web_fade_channel(int channel, int ms) { return EM_ASM_INT({ return Module['onsAudio']['fade']($0, $1); }, channel, ms); }
int ons_web_fade_music(int ms) { return EM_ASM_INT({ return Module['onsAudio']['fade']('music', $0); }, ms); }
int ons_web_seek_music(double seconds) { return EM_ASM_INT({ return Module['onsAudio']['seek']($0); }, seconds); }
void ons_web_channel_finished(void (*callback)(int)) { channel_finished = callback; }
void ons_web_music_finished(void (*callback)()) { music_finished = callback; }
void ons_web_music_loop(bool loop, double offset) { EM_ASM({ Module['onsAudio']['musicLoop']($0 != 0, $1); }, loop, offset); }
void ons_web_chain(int intro, int loop, Mix_Chunk *chunk)
{
    EM_ASM({ Module['onsAudio']['chain']($0, $1, 'chunk:' + $2); }, intro, loop, chunk);
}
#endif
