// SPDX-License-Identifier: GPL-2.0-or-later
#include "ONScripter.h"
#include "Utils.h"
#include <algorithm>

void ONScripter::resetCompatibility()
{
    const std::string initial_font = compatibility.default_font;
    cleanupCompatibility();
    compatibility = ONSCompatibility();
    compatibility.default_font = initial_font;
    compatibility_savepoint.clear();
    compatibility_restoring = false;
    compatibility_error_active = false;
}

int ONScripter::compatibilityCommand()
{
    if (script_h.isName("checksp")) {
        script_h.readVariable();
        script_h.pushVariable();
        const int no = script_h.readInt();
        if (no < 0 || no >= MAX_SPRITE_NUM)
            errorAndExit("checksp: sprite number out of range");
        script_h.setInt(&script_h.pushed_variable,
            sprite_info[no].image_surface && sprite_info[no].visible ? 1 : 0);
    }
    else if (script_h.isName("humanpos")) {
        for (int i = 0; i < 3; ++i) compatibility.human_position[i] = script_h.readInt();
        compatibility.human_position_set = true;
    }
    else if (script_h.isName("btnnowindowerase")) compatibility.keep_button_window = true;
    else if (script_h.isName("noteraseman")) compatibility.keep_people = true;
    else if (script_h.isName("bgmdownmode")) {
        compatibility.bgm_down = script_h.readInt() != 0;
        applyMusicVolume();
    }
    else if (script_h.isName("cdfadeout")) {
        compatibility.cd_fadeout = std::max(0, script_h.readInt());
    }
    else if (script_h.isName("lookbackvoice")) compatibility.lookback_voice = script_h.readStr();
    else if (script_h.isName("errorsave")) compatibility.error_save = true;
    else if (script_h.isName("mousecursor")) {
        compatibility.mouse_cursor = script_h.readStr();
        loadCompatibilityCursor(compatibility.mouse_cursor.c_str());
    }
    // dsound selects the legacy Windows audio backend. SDL is already open.
    return RET_CONTINUE;
}

void ONScripter::applyMusicVolume()
{
    const bool muted = current_cd_track >= 0 ? !cdaudio_on_flag : !volume_on_flag;
    const double duck = compatibility.bgm_down && Mix_Playing(0) ? 0.5 : 1.0;
    const int volume = muted ? 0 : static_cast<int>(
        std::max(0, std::min(100, music_volume)) * MIX_MAX_VOLUME / 100.0 *
        duck * compatibility.fade_gain);
    Mix_VolumeMusic(volume);
    Mix_Volume(MIX_BGM_CHANNEL, volume);
}

void ONScripter::applyWaveVolumes()
{
    for (int i = 0; i < ONS_MIX_CHANNELS + ONS_MIX_EXTRA_CHANNELS; ++i) {
        if (i == MIX_BGM_CHANNEL) continue;
        const int base = i == 0 ? voice_volume : se_volume;
        Mix_Volume(i, volume_on_flag ? std::max(0, std::min(100, base)) * MIX_MAX_VOLUME / 100 : 0);
    }
    applyMusicVolume();
}

void ONScripter::beforeErrorExit()
{
    if (!compatibility.error_save || compatibility_error_active ||
        current_mode != NORMAL_MODE || !current_page || !bg_info.image_surface) return;
    compatibility_error_active = true;
    storeSaveFile();
    // Error reporting must not recurse through saveAll/global-file failures.
    const int result = saveFileIOBuf("save999.dat");
    const bool companion = result == 0 && writeCompatibilityState(999, captureCompatibilityState());
    utils::printError("errorsave: diagnostic slot 999 %s\n", result ? "failed" : "written");
    showCompatibilityError(result == 0 && companion);
}

void ONScripter::fadeCDAudio()
{
    if (current_cd_track < 0 || compatibility.cd_fadeout <= 0) return;
    const bool music = Mix_PlayingMusic() != 0;
    const bool wave = Mix_Playing(MIX_BGM_CHANNEL) != 0;
    if (!music && !wave) return;
    cd_play_loop_flag = false;
    music_play_loop_flag = false;
    const int duration = compatibility.cd_fadeout;
    if (music) Mix_FadeOutMusic(duration);
    if (wave) Mix_FadeOutChannel(MIX_BGM_CHANNEL, duration);
    event_mode = WAIT_TIMER_MODE;
    waitEvent(duration);
}
