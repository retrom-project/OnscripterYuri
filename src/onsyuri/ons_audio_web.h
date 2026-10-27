// SPDX-License-Identifier: GPL-2.0-or-later
#ifndef ONS_AUDIO_WEB_H
#define ONS_AUDIO_WEB_H
#ifdef WEB
#include <SDL2/SDL_mixer.h>

Mix_Chunk *ons_web_load_wav(SDL_RWops *, int);
void ons_web_free_chunk(Mix_Chunk *);
Mix_Music *ons_web_load_music(SDL_RWops *, int);
void ons_web_free_music(Mix_Music *);
int ons_web_allocate_channels(int);
int ons_web_play_channel(int, Mix_Chunk *, int);
int ons_web_play_music(Mix_Music *, int);
int ons_web_playing(int);
int ons_web_playing_music();
int ons_web_volume(int, int);
int ons_web_music_volume(int);
void ons_web_pause(int);
void ons_web_resume(int);
void ons_web_pause_music();
void ons_web_resume_music();
int ons_web_halt_music();
int ons_web_fade_channel(int, int);
int ons_web_fade_music(int);
int ons_web_seek_music(double);
void ons_web_channel_finished(void (*)(int));
void ons_web_music_finished(void (*)());
void ons_web_music_loop(bool, double);
void ons_web_chain(int, int, Mix_Chunk *);

#ifndef ONS_AUDIO_WEB_IMPLEMENTATION
#define Mix_LoadWAV_RW ons_web_load_wav
#define Mix_FreeChunk ons_web_free_chunk
#define Mix_LoadMUS_RW ons_web_load_music
#define Mix_FreeMusic ons_web_free_music
#define Mix_AllocateChannels ons_web_allocate_channels
#undef Mix_PlayChannel
#define Mix_PlayChannel ons_web_play_channel
#define Mix_PlayMusic ons_web_play_music
#define Mix_Playing ons_web_playing
#define Mix_PlayingMusic ons_web_playing_music
#define Mix_Volume ons_web_volume
#define Mix_VolumeMusic ons_web_music_volume
#define Mix_Pause ons_web_pause
#define Mix_Resume ons_web_resume
#define Mix_PauseMusic ons_web_pause_music
#define Mix_ResumeMusic ons_web_resume_music
#define Mix_HaltMusic ons_web_halt_music
#define Mix_FadeOutChannel ons_web_fade_channel
#define Mix_FadeOutMusic ons_web_fade_music
#define Mix_SetMusicPosition ons_web_seek_music
#define Mix_ChannelFinished ons_web_channel_finished
#define Mix_HookMusicFinished ons_web_music_finished
#endif
#endif
#endif
