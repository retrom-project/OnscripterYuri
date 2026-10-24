// SPDX-License-Identifier: GPL-2.0-or-later
#include "ONScripter.h"
#include <cerrno>
#include <cstdint>
#include <cstring>

namespace {
const size_t maximum_state = 2 * 1024 * 1024;
bool nativeIdentity(FILE *fp, uint32_t &crc, uint32_t &size)
{
    unsigned char chunk[65536];crc = 0xffffffff;size = 0;
    while (const size_t n = ::fread(chunk, 1, sizeof(chunk), fp)) {
        if (n > 64 * 1024 * 1024 - size) return false;
        size += static_cast<uint32_t>(n);
        for (size_t i=0; i<n; ++i) {
            crc ^= chunk[i];
            for (int bit=0; bit<8; ++bit) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1)));
        }
    }
    crc ^= 0xffffffff;return !::ferror(fp);
}
void integer(std::string &out, int value)
{
    const uint32_t n = static_cast<uint32_t>(value);
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<char>(n >> (8 * i)));
}
void string(std::string &out, const std::string &value)
{
    integer(out, static_cast<int>(value.size())); out += value;
}
void font(std::string &out, const ONSFontSettings &f)
{
    string(out, f.path); integer(out, f.width); integer(out, f.height);
    integer(out, f.pitch_x); integer(out, f.pitch_y);
    integer(out, f.bold); integer(out, f.shadow); integer(out, f.metrics);
}
class Reader {
    const std::string &bytes;
    size_t offset = 4;
public:
    bool valid = true;
    explicit Reader(const std::string &b): bytes(b) {}
    int integer() {
        if (offset + 4 > bytes.size()) {valid = false; return 0;}
        uint32_t n = 0;
        for (int i = 0; i < 4; ++i) n |= static_cast<uint32_t>(static_cast<unsigned char>(bytes[offset++])) << (8 * i);
        return static_cast<int>(n);
    }
    std::string string() {
        const int n = integer();
        if (n < 0 || n > 32768 || static_cast<size_t>(n) > bytes.size() - offset) {valid = false; return "";}
        const std::string result = bytes.substr(offset, n); offset += n; return result;
    }
    ONSFontSettings font() {
        ONSFontSettings f; f.path = string(); f.width = integer(); f.height = integer();
        f.pitch_x = integer(); f.pitch_y = integer();
        f.bold = integer() != 0; f.shadow = integer() != 0; f.metrics = integer() != 0;
        if (f.metrics && (f.width <= 0 || f.width > 8192 || f.height <= 0 || f.height > 8192 || f.pitch_x <= 0 || f.pitch_y <= 0)) valid = false;
        return f;
    }
    bool complete() const {return valid && offset == bytes.size();}
};
}

std::string ONScripter::captureCompatibilityState() const
{
    std::string out("OCS1");
    integer(out, compatibility.human_position_set);
    for (int i = 0; i < 3; ++i) integer(out, compatibility.human_position[i]);
    integer(out, compatibility.keep_button_window); integer(out, compatibility.keep_people);
    integer(out, compatibility.bgm_down); integer(out, compatibility.error_save);
    integer(out, compatibility.menu_visible); integer(out, compatibility.menu_initialized); integer(out, compatibility.cd_fadeout);
    integer(out, voice_volume); integer(out, se_volume); integer(out, music_volume);
    integer(out, volume_on_flag); integer(out, cdaudio_on_flag); integer(out, text_speed_no);
    string(out, sentence_font.font_path); string(out, compatibility.pending_font);
    string(out, compatibility.lookback_voice); string(out, compatibility.mouse_cursor);
    font(out, compatibility.sprite_font);
    integer(out, static_cast<int>(compatibility.menus.size()));
    for (const ONSMenuItem &item : compatibility.menus) {
        string(out, item.label); string(out, item.action); integer(out, item.level);
    }
    integer(out, static_cast<int>(compatibility.menu_parents.size()));
    for (const int index : compatibility.menu_parents) integer(out, index);
    // Only live text sprites need their creation-time font settings on restore.
    int count = 0;
    for (const auto &entry : compatibility.sprite_fonts) {
        const int id = entry.first;
        const AnimationInfo &a = id < MAX_SPRITE_NUM ? sprite_info[id] : sprite2_info[id - MAX_SPRITE_NUM];
        if (a.trans_mode == AnimationInfo::TRANS_STRING && a.image_surface) ++count;
    }
    integer(out, count);
    for (const auto &entry : compatibility.sprite_fonts) {
        const int id = entry.first;
        const AnimationInfo &a = id < MAX_SPRITE_NUM ? sprite_info[id] : sprite2_info[id - MAX_SPRITE_NUM];
        if (a.trans_mode != AnimationInfo::TRANS_STRING || !a.image_surface) continue;
        integer(out, id); font(out, entry.second);
    }
    return out;
}

bool ONScripter::restoreCompatibilityState(const std::string &bytes)
{
    if (bytes.size() < 4 || bytes.size() > maximum_state || bytes.compare(0, 4, "OCS1")) return false;
    Reader r(bytes);
    ONSCompatibility next;
    next.default_font = compatibility.default_font;
    next.human_position_set = r.integer() != 0;
    for (int i = 0; i < 3; ++i) next.human_position[i] = r.integer();
    next.keep_button_window = r.integer() != 0; next.keep_people = r.integer() != 0;
    next.bgm_down = r.integer() != 0; next.error_save = r.integer() != 0;
    next.menu_visible = r.integer() != 0; next.menu_initialized = r.integer() != 0; next.cd_fadeout = r.integer();
    const int voice = r.integer(), se = r.integer(), music = r.integer();
    const bool volume = r.integer() != 0, cd = r.integer() != 0;
    const int speed = r.integer();
    const std::string face = r.string(); next.pending_font = r.string();
    next.lookback_voice = r.string(); next.mouse_cursor = r.string(); next.sprite_font = r.font();
    const int menus = r.integer();
    if (menus < 0 || menus > 512 || next.cd_fadeout < 0) return false;
    for (int i = 0; i < menus && r.valid; ++i) {
        ONSMenuItem item; item.label = r.string(); item.action = r.string(); item.level = r.integer();
        if (item.level < 0 || item.level > 32) return false;
        next.menus.push_back(item);
    }
    const int parents = r.integer();
    if (parents < 0 || parents > 33 || speed < 0 || speed > 2) return false;
    for (int i = 0; i < parents && r.valid; ++i) {
        const int index = r.integer();
        if (index < 0 || index >= menus || next.menus[index].action != "sub" || next.menus[index].level != i) return false;
        next.menu_parents.push_back(index);
    }
    const int sprites = r.integer();
    if (sprites < 0 || sprites > MAX_SPRITE_NUM + MAX_SPRITE2_NUM) return false;
    for (int i = 0; i < sprites && r.valid; ++i) {
        const int id = r.integer();
        if (id < 0 || id >= MAX_SPRITE_NUM + MAX_SPRITE2_NUM || next.sprite_fonts.count(id)) return false;
        next.sprite_fonts[id] = r.font();
    }
    if (!r.complete()) return false;
    compatibility = next;
    sentence_font.font_path = face;
    sentence_font.ttf_font[0] = sentence_font.ttf_font[1] = NULL;
    voice_volume = voice; se_volume = se; music_volume = music;
    volume_on_flag = volume; cdaudio_on_flag = cd; text_speed_no = speed;
    updateCompatibilityMenu();
    if (!next.mouse_cursor.empty()) loadCompatibilityCursor(next.mouse_cursor.c_str());
    return true;
}

bool ONScripter::writeCompatibilityState(int no, const std::string &snapshot)
{
    const std::string state = snapshot.empty() ? captureCompatibilityState() : snapshot;
    if (state.size() > maximum_state) return false;
    char native[48];snprintf(native,sizeof(native),"save%d.dat",no);
    FILE *original=fopen(native,"rb",true);if(!original)return false;
    uint32_t crc=0,size=0;const bool identified=nativeIdentity(original,crc,size);::fclose(original);
    if(!identified)return false;
    std::string bytes("OCF1");integer(bytes,static_cast<int>(size));integer(bytes,static_cast<int>(crc));bytes+=state;
    char name[48], temporary[48];
    snprintf(name, sizeof(name), "save%d.compat", no);
    snprintf(temporary, sizeof(temporary), "save%d.compat.tmp", no);
    FILE *fp = fopen(temporary, "wb", true);
    if (!fp) return false;
    const bool written = ::fwrite(bytes.data(), 1, bytes.size(), fp) == bytes.size();
    const bool closed = ::fclose(fp) == 0;
    const std::string prefix = save_dir ? save_dir : archive_path;
    if (!written || !closed || ::rename((prefix + temporary).c_str(), (prefix + name).c_str())) {
        ::remove((prefix + temporary).c_str()); return false;
    }
    return true;
}

bool ONScripter::loadCompatibilityState(int no)
{
    char name[48]; snprintf(name, sizeof(name), "save%d.compat", no);
    FILE *fp = fopen(name, "rb", true);
    // Original NScripter native slots have no extension state.
    if (!fp) return errno == ENOENT;
    if (::fseek(fp, 0, SEEK_END)) {::fclose(fp); return false;}
    const long size = ::ftell(fp);
    if (size < 16 || static_cast<size_t>(size) > maximum_state + 12 || ::fseek(fp, 0, SEEK_SET)) {::fclose(fp); return false;}
    std::string bytes(size, '\0');
    const bool read = ::fread(&bytes[0], 1, size, fp) == static_cast<size_t>(size);
    ::fclose(fp);
    if (!read || bytes.compare(0,4,"OCF1")) return false;
    Reader binding(bytes);const uint32_t expected_size=static_cast<uint32_t>(binding.integer());const uint32_t expected_crc=static_cast<uint32_t>(binding.integer());
    char native[48];snprintf(native,sizeof(native),"save%d.dat",no);
    FILE *original=fopen(native,"rb",true);if(!original)return false;
    uint32_t crc=0,length=0;const bool identified=nativeIdentity(original,crc,length);::fclose(original);
    return identified && length==expected_size && crc==expected_crc && restoreCompatibilityState(bytes.substr(12));
}
