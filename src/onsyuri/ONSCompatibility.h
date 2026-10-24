// SPDX-License-Identifier: GPL-2.0-or-later
#ifndef ONS_COMPATIBILITY_H
#define ONS_COMPATIBILITY_H

#include <map>
#include <string>
#include <vector>

struct ONSFontSettings {
    std::string path;
    int width = 0, height = 0, pitch_x = 0, pitch_y = 0;
    bool bold = false, shadow = false, metrics = false;
};

struct ONSMenuItem {
    std::string label, action;
    int level = 0;
};

struct ONSCompatibility {
    int human_position[3] = {0, 0, 0};
    bool human_position_set = false;
    bool keep_button_window = false;
    bool keep_people = true; // The renderer already retains people on textoff.
    bool bgm_down = false;
    bool error_save = false;
    bool menu_visible = false;
    bool menu_initialized = false;
    int cd_fadeout = 0;
    double fade_gain = 1.0;
    std::string default_font, pending_font, lookback_voice, mouse_cursor;
    ONSFontSettings sprite_font;
    std::map<int, ONSFontSettings> sprite_fonts;
    std::vector<ONSMenuItem> menus;
    std::vector<int> menu_parents;
};

#define ONS_COMPAT_MENU_EVENT (SDL_USEREVENT + 16)

#endif
