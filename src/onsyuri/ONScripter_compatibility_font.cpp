// SPDX-License-Identifier: GPL-2.0-or-later
#include "ONScripter.h"
#include "Utils.h"
#include <algorithm>
#include <cstdint>

std::string ONScripter::resolveCompatibilityFont(const char *name)
{
    if (compatibility.default_font.empty() && font_file)
        compatibility.default_font = font_file;
    std::string path = name ? name : "";
    std::replace(path.begin(), path.end(), '\\', '/');
    if (path.empty()) return compatibility.default_font;
    if (path[0] != '/') path = std::string(archive_path ? archive_path : "") + path;
    FILE *fp = ::fopen(path.c_str(), "rb");
    if (fp) {::fclose(fp); return path;}
    // Windows family names are not paths. Use the project's supplied font,
    // retaining its language coverage, and make the substitution observable.
    utils::printInfo("font substitution: %s -> %s\n", name, compatibility.default_font.c_str());
    return compatibility.default_font;
}

void ONScripter::applyPendingFont()
{
    if (compatibility.pending_font.empty()) return;
    sentence_font.font_path = compatibility.pending_font;
    sentence_font.ttf_font[0] = sentence_font.ttf_font[1] = NULL;
    compatibility.pending_font.clear();
}

int ONScripter::compatibilityFontCommand()
{
    if (script_h.isName("spfont")) {
        if (script_h.compareString("clear")) {
            script_h.readLabel();
            compatibility.sprite_font = ONSFontSettings();
            return RET_CONTINUE;
        }
        ONSFontSettings settings;
        settings.path = resolveCompatibilityFont(script_h.readStr());
        if (script_h.getEndStatus() & ScriptHandler::END_COMMA) {
            settings.width = script_h.readInt();
            settings.height = script_h.readInt();
            settings.pitch_x = settings.width + script_h.readInt();
            settings.pitch_y = settings.height + script_h.readInt();
            settings.bold = script_h.readInt() != 0;
            settings.shadow = script_h.readInt() != 0;
            settings.metrics = true;
            if (settings.width <= 0 || settings.height <= 0 || settings.pitch_x <= 0 || settings.pitch_y <= 0)
                errorAndExit("spfont: invalid font dimensions");
        }
        compatibility.sprite_font = settings;
    }
    else {
        compatibility.pending_font = resolveCompatibilityFont(script_h.readStr());
        // This fork accepts the observed one-string setfont extension. Like
        // font, it preserves an already drawn page until the next clear.
        if (current_mode == DEFINE_MODE || (current_page && current_page->text_count == 0)) applyPendingFont();
    }
    return RET_CONTINUE;
}

void ONScripter::compatibilityUserFont(const char *path)
{
    compatibility.pending_font = resolveCompatibilityFont(path);
    if (current_page && current_page->text_count == 0) applyPendingFont();
}

void ONScripter::configureCompatibilityFont(AnimationInfo *anim, FontInfo &info)
{
    if (anim->font_size_xy[0] < 0) return; // Explicit menu FontInfo belongs to the menu.
    const uintptr_t address = reinterpret_cast<uintptr_t>(anim);
    const uintptr_t first = reinterpret_cast<uintptr_t>(sprite_info);
    const uintptr_t second = reinterpret_cast<uintptr_t>(sprite2_info);
    int id = -1;
    if (address >= first && address < first + sizeof(AnimationInfo) * MAX_SPRITE_NUM)
        id = static_cast<int>((address - first) / sizeof(AnimationInfo));
    else if (address >= second && address < second + sizeof(AnimationInfo) * MAX_SPRITE2_NUM)
        id = MAX_SPRITE_NUM + static_cast<int>((address - second) / sizeof(AnimationInfo));
    if (compatibility_restoring && id >= 0 && compatibility.sprite_fonts.count(id)) {
        const ONSFontSettings &f = compatibility.sprite_fonts[id];
        info.font_path = f.path;
        info.font_size_xy[0] = f.width; info.font_size_xy[1] = f.height;
        info.pitch_xy[0] = f.pitch_x; info.pitch_xy[1] = f.pitch_y;
        info.is_bold = f.bold; info.is_shadow = f.shadow;
    }
    else {
        const ONSFontSettings &f = compatibility.sprite_font;
        if (!f.path.empty()) info.font_path = f.path;
        if (f.metrics && anim->is_single_line) {info.is_bold = f.bold; info.is_shadow = f.shadow;}
        if (id >= 0) {
            ONSFontSettings saved;
            saved.path = info.font_path;
            saved.width = info.font_size_xy[0]; saved.height = info.font_size_xy[1];
            saved.pitch_x = info.pitch_xy[0]; saved.pitch_y = info.pitch_xy[1];
            saved.bold = info.is_bold; saved.shadow = info.is_shadow; saved.metrics = true;
            compatibility.sprite_fonts[id] = saved;
        }
    }
    info.ttf_font[0] = info.ttf_font[1] = NULL;
}
