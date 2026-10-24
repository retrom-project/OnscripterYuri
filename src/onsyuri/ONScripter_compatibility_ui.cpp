// SPDX-License-Identifier: GPL-2.0-or-later
#include "ONScripter.h"
#include "Utils.h"
#include <algorithm>
#include <cstdint>
#include <sstream>

#if defined(WEB)
#include <emscripten.h>

EM_JS(void, ons_compatibility_init, (), {
    if (Module.onsCompatibility)
        return;
    const canvas = Module.canvas;
    const state = { root: null, timer: 0, generation: 0, cursor: canvas.style.cursor, font: 0, dialogs: new Set() };
    state.clearCursor = () => { clearTimeout(state.timer); state.timer = 0; state.generation++; canvas.style.cursor = state.cursor; };
    state.close = () => { for (const node of state.dialogs)
        node.remove(); state.dialogs.clear(); };
    state.destroy = () => { state.clearCursor(); state.close(); state.root?.remove(); };
    Module.onsCompatibility = state;
});

EM_JS(void, ons_compatibility_menu, (const char *json), {
    const state = Module.onsCompatibility, data = JSON.parse(UTF8ToString(json));
    state.root?.remove();
    state.root = null;
    if (!data.visible || !data.items.length)
        return;
    const root = document.createElement('details');
    root.dataset.onsMenu = "";
    Object.assign(root.style, { position: 'fixed', right: '8px', top: '8px', zIndex: '2147483646', font: '14px sans-serif', color: '#eee', background: '#20242bf0', border: '1px solid #667', borderRadius: '6px', maxHeight: '90vh', overflow: 'auto', maxWidth: '90vw' });
    const heading = document.createElement('summary');
    heading.textContent = '☰';
    heading.title = 'Game menu';
    heading.setAttribute('aria-label', 'Game menu');
    heading.style.padding = '6px 10px';
    root.append(heading);
    const body = document.createElement('div');
    body.style.padding = '4px';
    root.append(body);
    const queue = (action, value = 0) => Module._onsyuri_menu_action(action, value);
    const dialog = title => { state.close(); const node = document.createElement('dialog'); node.setAttribute('aria-label', title); node.style.cssText = 'color:#eee;background:#20242b;border:1px solid #667;border-radius:8px;max-width:90vw'; const h = document.createElement('h3'); h.textContent = title; node.append(h); const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => { node.close(); node.remove(); state.dialogs.delete(node); Module.canvas.focus(); }; node.append(close); document.body.append(node); state.dialogs.add(node); node.showModal(); return node; };
    const font = () => { const node = dialog('Font'); const input = document.createElement('input'); input.type = 'file'; input.accept = '.ttf,.otf,.ttc'; input.setAttribute('aria-label', 'Font file'); input.onchange = async () => { const f = input.files?.[0]; if (!f)
        return; if (f.size > 32 * 1024 * 1024) {
        input.setCustomValidity('Font is larger than 32 MiB');
        input.reportValidity();
        return;
    } const id = ++state.font; Module.FS.writeFile('/save/menu-font-' + id + '.ttf', new Uint8Array(await f.arrayBuffer())); queue(17, id); node.close(); node.remove(); state.dialogs.delete(node); Module.canvas.focus(); }; node.prepend(input); };
    const volume = () => { const node = dialog('Volume'); for (const [label, key, action] of [['Music', 0, 14], ['Voice', 1, 15], ['Sound effects', 2, 16]]) {
        const row = document.createElement('label');
        row.style.display = 'block';
        row.textContent = label;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = '100';
        range.value = String(Module._onsyuri_menu_value(key));
        range.setAttribute('aria-label', label);
        range.oninput = () => queue(action, Number(range.value));
        row.append(range);
        node.prepend(row);
    } };
    const codes = { end: 1, reset: 2, skip: 3, auto: 4, textslow: 5, textmiddle: 6, textfast: 7, clickdef: 8, clickpage: 9, waveon: 10, waveoff: 11, cdon: 12, cdoff: 13 };
    const action = name => {
        root.open = false;
        if (name === 'version') {
            const node = dialog('Version');
            const text = document.createElement('pre');
            text.textContent = data.version;
            node.prepend(text);
            return;
        }
        if (name === 'font') {
            font();
            return;
        }
        if (name === 'dwavevolume') {
            volume();
            return;
        }
        if (name === 'full') {
            const target = Module.canvas.parentElement;
            target.requestFullscreen?.().catch(e => console.warn('Fullscreen: ' + e));
            queue(18);
            return;
        }
        if (name === 'window') {
            if (document.fullscreenElement)
                document.exitFullscreen?.().catch(e => console.warn('Fullscreen: ' + e));
            queue(19);
            return;
        }
        if (codes[name])
            queue(codes[name]);
        Module.canvas.focus();
    };
    const parents = [body];
    for (const item of data.items) {
        const parent = parents[item.level];
        if (!parent)
            continue;
        const text = item.label.replace(/&&|&/g, value => value === '&&' ? '&' : "");
        if (item.action === 'sub') {
            const child = document.createElement('details'), summary = document.createElement('summary'), box = document.createElement('div');
            summary.textContent = text;
            summary.style.padding = '5px';
            box.style.paddingLeft = '12px';
            child.append(summary, box);
            parent.append(child);
            parents.length = item.level + 1;
            parents.push(box);
        }
        else {
            const button = document.createElement('button');
            button.textContent = text;
            button.dataset.onsAction = item.action;
            button.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 10px;background:transparent;color:inherit;border:0;cursor:pointer';
            button.onclick = () => action(item.action);
            parent.append(button);
        }
    }
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'wheel'])
        root.addEventListener(type, e => e.stopPropagation());
    document.body.append(root);
    state.root = root;
});

EM_JS(void, ons_compatibility_cursor, (const unsigned char *pointer, int length), {
    const state = Module.onsCompatibility;
    state.clearCursor();
    const generation = state.generation;
    const data = HEAPU8.slice(pointer, pointer + length);
    const four = (b, o) => String.fromCharCode(...b.subarray(o, o + 4));
    const cursor = async (bytes) => {
        const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length < 22 || d.getUint16(0, true) !== 0 || d.getUint16(2, true) !== 2 || d.getUint16(4, true) < 1)
            throw Error('Invalid CUR directory');
        const count = d.getUint16(4, true);
        if (6 + count * 16 > bytes.length)
            throw Error('Truncated CUR directory');
        const n = d.getUint32(14, true), offset = d.getUint32(18, true), x = d.getUint16(10, true), y = d.getUint16(12, true);
        if (offset < 6 + count * 16 || n < 16 || offset + n > bytes.length)
            throw Error('Truncated CUR image');
        const width = bytes[6] || 256, height = bytes[7] || 256;
        if (x >= width || y >= height)
            throw Error('Invalid cursor hotspot');
        const ico = new Uint8Array(22 + n);
        ico.set(bytes.subarray(0, 22));
        const view = new DataView(ico.buffer);
        view.setUint16(2, 1, true);
        view.setUint16(4, 1, true);
        view.setUint16(10, 1, true);
        view.setUint16(12, four(bytes, offset + 1) === 'PNG\r' ? 32 : new DataView(bytes.buffer, bytes.byteOffset + offset, n).getUint16(14, true), true);
        view.setUint32(18, 22, true);
        ico.set(bytes.subarray(offset, offset + n), 22);
        const url = URL.createObjectURL(new Blob([ico], { type: 'image/x-icon' }));
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return { value: 'url("' + c.toDataURL('image/png') + '") ' + x + ' ' + y + ', auto', width: c.width, height: c.height, x, y };
        }
        finally {
            URL.revokeObjectURL(url);
        }
    };
    (async () => {
        let frames = [data], sequence = [0], rates = [6];
        if (four(data, 0) === 'RIFF') {
            if (data.length < 12 || four(data, 8) !== 'ACON')
                throw Error('Invalid ANI form');
            const d = new DataView(data.buffer), declared = d.getUint32(4, true);
            // One observed legacy encoder counts the outer 8-byte RIFF header.
            // Only accept that exact overcount; every inner chunk is still bounded.
            if (declared + 8 !== data.length && declared !== data.length)
                throw Error('Truncated ANI form');
            frames = [];
            let header = null, rate = null, seq = null;
            const walk = (start, end, inFrames = false) => { let o = start; for (; o + 8 <= end;) {
                const tag = four(data, o), size = d.getUint32(o + 4, true), next = o + 8 + size;
                if (next > end)
                    throw Error('Truncated ANI chunk');
                if (tag === 'anih') {
                    if (size < 36)
                        throw Error('Invalid ANI header');
                    header = Array.from({ length: 9 }, (_, i) => d.getUint32(o + 8 + i * 4, true));
                }
                else if (tag === 'rate' || tag === 'seq ') {
                    if (size % 4)
                        throw Error('Invalid ANI step table');
                    const values = Array.from({ length: size / 4 }, (_, i) => d.getUint32(o + 8 + i * 4, true));
                    if (tag === 'rate')
                        rate = values;
                    else
                        seq = values;
                }
                else if (tag === 'LIST') {
                    if (size < 4)
                        throw Error('Invalid ANI list');
                    if (four(data, o + 8) === 'fram')
                        walk(o + 12, next, true);
                }
                else if (tag === 'icon' && inFrames)
                    frames.push(data.slice(o + 8, next));
                o = next + (size & 1);
            } if (o !== end)
                throw Error('Incomplete ANI chunks'); };
            walk(12, data.length);
            if (!header || !(header[8] & 1) || header[1] !== frames.length || !frames.length || frames.length > 256 || header[2] < 1 || header[2] > 4096)
                throw Error('Unsupported ANI frame layout');
            sequence = seq ?? Array.from({ length: header[2] }, (_, i) => i % frames.length);
            rates = rate ?? Array(header[2]).fill(header[7]);
            if (sequence.length !== header[2] || rates.length !== header[2] || sequence.some(i => i >= frames.length) || rates.some(n => !n))
                throw Error('Invalid ANI playback steps');
        }
        const images = await Promise.all(frames.map(cursor));
        let step = 0;
        const draw = () => { if (state.generation !== generation)
            return; const frame = images[sequence[step]]; if (Module.canvas.style.cursor !== 'none')
            Module.canvas.style.cursor = frame.value; Module.canvas.dataset.onsCursor = JSON.stringify({ frame: sequence[step], frames: images.length, width: frame.width, height: frame.height, x: frame.x, y: frame.y }); const delay = rates[step] * 1000 / 60; step = (step + 1) % sequence.length; if (sequence.length > 1)
            state.timer = setTimeout(draw, delay); };
        draw();
    })().catch(error => console.warn('mousecursor: ' + error.message));
});

EM_JS(void, ons_compatibility_cleanup, (), {
    Module.onsCompatibility?.destroy();
    delete Module.onsCompatibility;
});

EM_ASYNC_JS(void, ons_compatibility_error, (int saved), {
    const state = Module.onsCompatibility;
    const node = document.createElement('dialog');
    node.dataset.onsError = "";
    node.setAttribute('aria-label', 'Game script error');
    node.style.cssText = 'color:#eee;background:#20242b;border:1px solid #667;max-width:90vw';
    const text = document.createElement('p');
    text.textContent = saved ? 'The game script stopped. A diagnostic save is available.' : 'The game script stopped. The diagnostic save could not be written.';
    node.append(text);
    const urls = [];
    if (saved)
        for (const [name, label] of [['save999.dat', 'Download diagnostic save'], ['save999.compat', 'Download companion state']]) {
            const url = URL.createObjectURL(new Blob([Module.FS.readFile('/save/' + name)], { type: 'application/octet-stream' }));
            urls.push(url);
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            link.textContent = label;
            link.style.cssText = 'display:block;padding:8px';
            node.append(link);
        }
    const close = document.createElement('button');
    close.textContent = 'Close';
    node.append(close);
    state.dialogs.add(node);
    document.body.append(node);
    node.showModal();
    await new Promise(resolve => { close.onclick = () => { node.close(); resolve(); }; node.oncancel = e => { e.preventDefault(); node.close(); resolve(); }; });
    node.remove();
    state.dialogs.delete(node);
    for (const url of urls)
        URL.revokeObjectURL(url);
});
#endif

namespace {
std::string utf8(const std::string &raw)
{
    std::vector<char> bytes(raw.size() * 3 + 1);
    DirectReader::convertCodingToUTF8(bytes.data(), raw.c_str());
    return bytes.data();
}
std::string quote(const std::string &value)
{
    std::string out = "\"";
    for (const unsigned char c : value) {
        if (c == '"' || c == '\\') {out += '\\'; out += c;}
        else if (c < 32) {char escaped[7]; snprintf(escaped, sizeof(escaped), "\\u%04x", c); out += escaped;}
        else out += c;
    }
    return out + "\"";
}
void legacyMenu(std::vector<ONSMenuItem> &items)
{
    const char *labels[] = {"Display","Fullscreen","Window","Font","Page display","Default","Whole page","Text speed","Slow","Normal","Fast","Sound","On","Off","Volume","Skip","Auto","CD audio","On","Off","Version","Quit"};
    const char *actions[] = {"sub","full","window","font","sub","clickdef","clickpage","sub","textslow","textmiddle","textfast","sub","waveon","waveoff","dwavevolume","skip","auto","sub","cdon","cdoff","version","end"};
    const int levels[] = {0,1,1,0,0,1,1,0,1,1,1,0,1,1,1,0,0,0,1,1,0,0};
    for (size_t i = 0; i < sizeof(levels)/sizeof(levels[0]); ++i) {ONSMenuItem item;item.label=labels[i];item.action=actions[i];item.level=levels[i];items.push_back(item);}
}
}

int ONScripter::compatibilityMenuCommand()
{
    if (!compatibility.menu_initialized) {
        compatibility.menu_initialized = true;
        compatibility.menu_visible = true;
        legacyMenu(compatibility.menus);
    }
    if (script_h.isName("resetmenu")) {
        compatibility.menus.clear();compatibility.menu_parents.clear();compatibility.menu_visible=true;
    }
    else if (script_h.isName("deletemenu")) compatibility.menu_visible=false;
    else if (script_h.isName("killmenu")) {
        const int requested=script_h.readInt();int index=-1;
        for(size_t i=0;i<compatibility.menus.size();++i)if(compatibility.menus[i].level==0&&++index==requested){
            size_t end=i+1;while(end<compatibility.menus.size()&&compatibility.menus[end].level>0)++end;
            compatibility.menus.erase(compatibility.menus.begin()+i,compatibility.menus.begin()+end);break;
        }
        compatibility.menu_parents.clear();
    }
    else {
        ONSMenuItem item;item.label=script_h.readStr();item.action=script_h.readLabel();
        if(script_h.getEndStatus()&ScriptHandler::END_COMMA)item.level=script_h.readInt();
        if(item.level<0||item.level>32||compatibility.menus.size()>=512)errorAndExit("insertmenu: invalid menu depth or size");
        if(item.level>static_cast<int>(compatibility.menu_parents.size()))errorAndExit("insertmenu: missing parent submenu");
        const int position=item.level?compatibility.menu_parents[item.level-1]+1:0;
        for(int &parent:compatibility.menu_parents)if(parent>=position)++parent;
        compatibility.menus.insert(compatibility.menus.begin()+position,item);
        compatibility.menu_parents.resize(item.level);
        if(item.action=="sub")compatibility.menu_parents.push_back(position);
        compatibility.menu_visible=true;
    }
    updateCompatibilityMenu();return RET_CONTINUE;
}

void ONScripter::updateCompatibilityMenu()
{
#if defined(WEB)
    ons_compatibility_init();
    std::ostringstream out;out<<"{\"visible\":"<<(compatibility.menu_visible?"true":"false")<<",\"version\":"<<quote(utf8(version_str?version_str:"ONScripterYuri"))<<",\"items\":[";
    bool comma=false;for(const ONSMenuItem &item:compatibility.menus){if(comma)out<<',';comma=true;out<<"{\"label\":"<<quote(utf8(item.label))<<",\"action\":"<<quote(item.action)<<",\"level\":"<<item.level<<'}';}
    out<<"]}";ons_compatibility_menu(out.str().c_str());
#endif
}

void ONScripter::cleanupCompatibility()
{
#if defined(WEB)
    ons_compatibility_cleanup();
#endif
}

void ONScripter::showCompatibilityError(bool saved)
{
#if defined(WEB)
    ons_compatibility_init();ons_compatibility_error(saved ? 1 : 0);
#endif
}

void ONScripter::loadCompatibilityCursor(const char *name)
{
#if defined(WEB)
    if(!name||!*name)return;
    const unsigned long length=script_h.cBR->getFileLength(name);
    if(!length||length>16*1024*1024){utils::printError("mousecursor: missing or oversized cursor %s\n",name);return;}
    std::vector<unsigned char> bytes(length);
    if(script_h.cBR->getFile(name,bytes.data())!=length){utils::printError("mousecursor: cannot read cursor %s\n",name);return;}
    ons_compatibility_init();ons_compatibility_cursor(bytes.data(),static_cast<int>(length));
#endif
}

void ONScripter::queueCompatibilityAction(int action,int value)
{
    SDL_Event event={};event.type=ONS_COMPAT_MENU_EVENT;event.user.code=action;
    event.user.data1=reinterpret_cast<void *>(static_cast<intptr_t>(value));SDL_PushEvent(&event);
}

int ONScripter::compatibilityValue(int key) const
{
    return key==0?music_volume:key==1?voice_volume:se_volume;
}

void ONScripter::executeCompatibilityAction(int action,int value)
{
    switch(action){
    case 1:system_menu_mode=SYSTEM_END;break;
    case 2:system_menu_mode=SYSTEM_RESET;break;
    case 3:system_menu_mode=SYSTEM_SKIP;break;
    case 4:system_menu_mode=SYSTEM_AUTOMODE;break;
    case 5:case 6:case 7:text_speed_no=action-5;break;
    case 8:menu_click_defCommand();break;
    case 9:menu_click_pageCommand();break;
    case 10:case 11:volume_on_flag=action==10;applyWaveVolumes();break;
    case 12:case 13:cdaudio_on_flag=action==12;applyMusicVolume();break;
    case 14:music_volume=std::max(0,std::min(100,value));applyMusicVolume();break;
    case 15:voice_volume=std::max(0,std::min(100,value));applyWaveVolumes();break;
    case 16:se_volume=std::max(0,std::min(100,value));applyWaveVolumes();break;
    case 17:{char path[64];snprintf(path,sizeof(path),"/save/menu-font-%d.ttf",value);compatibilityUserFont(path);break;}
    case 18:case 19:fullscreen_mode=action==18;break;
    default:break;
    }
}
