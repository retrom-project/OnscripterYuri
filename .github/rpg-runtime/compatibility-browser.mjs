// SPDX-License-Identifier: MIT
// Authored behavior fixtures; no private game content or inferred checkout inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [assets, sans, serif, playwrightModule, browserExecutable, output] = process.argv.slice(2);
assert.equal(process.argv.length, 8, "usage: node compatibility-browser.mjs <assets> <sans.ttf> <serif.ttf> <playwright-module> <browser> <new-output>");
assert([assets, sans, serif, playwrightModule, browserExecutable, output].every(path.isAbsolute));
await fs.mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bmp = (width, height, rgb) => {
    const stride = (width * 3 + 3) & ~3, b = Buffer.alloc(54 + stride * height);
    b.write("BM");
    b.writeUInt32LE(b.length, 2);
    b.writeUInt32LE(54, 10);
    b.writeUInt32LE(40, 14);
    b.writeInt32LE(width, 18);
    b.writeInt32LE(height, 22);
    b.writeUInt16LE(1, 26);
    b.writeUInt16LE(24, 28);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const i = 54 + y * stride + x * 3;
            b[i] = rgb[2];
            b[i + 1] = rgb[1];
            b[i + 2] = rgb[0];
        }
    return b;
};
const define = `; SPDX-License-Identifier: MIT\n*define\nwindowback\ndefaultspeed 0,0,0\nsavenumber 2\n`;
const windowScript = `setwindow 16,340,40,5,20,20,0,2,0,1,1,"#444444",0,320,639,479\n`;
const success = `bg #00aa00,1\nclick\ngoto *success\n*fail\nbg #aa0000,1\nclick\ngoto *fail\n`;
const cases = new Map([
    ["query-and-volume", { script: define + `defbgmvol 37\ndefvoicecol 61\ndsound\ngame\n*start\ngetmp3vol %1\nif %1!=37 goto *fail\ngetvoicevol %1\nif %1!=61 goto *fail\nmov %1,99\nchecksp %1,100\nif %1!=0 goto *fail\nlsp 100,":c;human.bmp",20,20\nchecksp %1,100\nif %1!=1 goto *fail\nvsp 100,0\nchecksp %1,100\nif %1!=0 goto *fail\ncsp 100\nchecksp %1,100\nif %1!=0 goto *fail\n*success\n` + success,
            async verify(page) {
                // Startup readiness precedes asynchronous project-image reads.
                await page.waitForFunction(() => {const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.drawImage(window.native.canvas,0,0);const p=ctx.getImageData(10,10,1,1).data;return p[0]+p[1]+p[2]>0}, null, {timeout:10000});
                assert.deepEqual(await pixel(page,10,10),[0,170,0,255]);
            } }],
    ["human-position", { script: define + `humanpos 100,320,540\ngame\n*start\nbg #000000,1\nld l,":c;human.bmp",1\nld c,":c;human.bmp",1\nld r,":c;human.bmp",1\nclick\ngoto *start\n`,
            async verify(page) {
                for (const x of [100, 320, 540]) {
                    const p = await pixel(page, x, 450);
                    assert(p[0] === 0 && p[1] >= 250 && p[2] === 0, "person not at humanpos anchor");
                }
                for (const x of [160, 480])
                    assert.deepEqual(await pixel(page, x, 450), [0, 0, 0, 255]);
            } }],
    ["button-window", { script: define + `btnnowindowerase\nnoteraseman\ngame\n*start\nbg #000000,1\n` + windowScript + `lsp 100,":c;human.bmp",300,200\nspbtn 100,1\nprint 1\nputtext "VISIBLE"\nbtnwait %1\nif %1!=1 goto *fail\n*success\n` + success,
            async verify(page) {
                assert((await region(page, 16, 340, 150, 30)).some(n => n > 128), "button wait erased the text window");
                await page.locator("canvas").click({ position: { x: 310, y: 220 } });
                await page.waitForTimeout(100);
                assert.deepEqual(await pixel(page, 10, 10), [0, 170, 0, 255]);
            } }],
]);
const cur = color => {
    const b = Buffer.alloc(22 + 40 + 32 * 32 * 4 + 128);
    b.writeUInt16LE(2, 2);
    b.writeUInt16LE(1, 4);
    b[6] = b[7] = 32;
    b.writeUInt16LE(9, 10);
    b.writeUInt16LE(10, 12);
    b.writeUInt32LE(b.length - 22, 14);
    b.writeUInt32LE(22, 18);
    b.writeUInt32LE(40, 22);
    b.writeInt32LE(32, 26);
    b.writeInt32LE(64, 30);
    b.writeUInt16LE(1, 34);
    b.writeUInt16LE(32, 36);
    for (let i = 62; i < 62 + 4096; i += 4) {
        b[i] = color[2];
        b[i + 1] = color[1];
        b[i + 2] = color[0];
        b[i + 3] = 255;
    }
    return b;
};
const chunk = (tag, bytes) => { const h = Buffer.alloc(8); h.write(tag); h.writeUInt32LE(bytes.length, 4); return Buffer.concat([h, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]); };
const ani = (legacy = false) => {
    const frames = legacy ? [cur([0, 255, 0])] : [cur([0, 255, 0]), cur([255, 0, 0])], header = Buffer.alloc(36);
    [36, frames.length, legacy ? 1 : 3, 0, 0, 32, 1, 6, legacy ? 1 : 3].forEach((v, i) => header.writeUInt32LE(v, i * 4));
    const table = values => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
    const body = Buffer.concat([Buffer.from('ACON'), chunk('anih', header), ...(legacy ? [] : [chunk('rate', table([12, 6, 12])), chunk('seq ', table([1, 0, 1]))]), chunk('LIST', Buffer.concat([Buffer.from('fram'), ...frames.map(f => chunk('icon', f))]))]);
    const h = Buffer.alloc(8);
    h.write('RIFF');
    h.writeUInt32LE(body.length + (legacy ? 8 : 0), 4);
    return Buffer.concat([h, body]);
};
const wav = (hz, seconds) => {
    const n = Math.round(44100 * seconds), b = Buffer.alloc(44 + n * 2);
    b.write('RIFF');
    b.writeUInt32LE(b.length - 8, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(44100, 24);
    b.writeUInt32LE(88200, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++)
        b.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * hz / 44100) * 6000), 44 + i * 2);
    return b;
};
// A non-repeating, stereo signal distinguishes stale output from intentional
// looping music. Keep it long enough to outlast startup and injected long tasks.
const audioProbe = () => {
    const n = 44100 * 20, b = Buffer.alloc(44 + n * 4);
    b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
    b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28);
    b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
    b.write('data', 36); b.writeUInt32LE(n * 4, 40);
    let seed = 123456789;
    for (let i = 0; i < n; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const value = (seed & 8191) - 4096;
        b.writeInt16LE(value, 44 + i * 4);
        b.writeInt16LE(-value, 46 + i * 4);
    }
    return b;
};
cases.set('audio-underrun', { script: define + `game\n*start\nbg #000000,1\nbgm "probe.wav"\n*wait\nclick\ngoto *wait\n`, async verify(page, caseId) {
        const result = await page.evaluate(async () => {
            const ac = window.actualAudioContext;
            const url = URL.createObjectURL(new Blob([`class Capture extends AudioWorkletProcessor {
                constructor() { super(); this.samples = new Float32Array(4096); this.position = 0;
                    this.port.onmessage = () => { this.port.postMessage(Array.from(this.samples.subarray(0, this.position))); this.position = 0; }; }
                process(inputs, outputs) {
                    const channels = inputs[0];
                    for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(channels[c] || new Float32Array(128));
                    for (let i = 0; i < outputs[0][0].length; i++) {
                        this.samples[this.position++] = outputs[0][0][i];
                        if (this.position === this.samples.length) {
                            this.port.postMessage(Array.from(this.samples)); this.position = 0;
                        }
                    }
                    return true;
                }
            } registerProcessor('capture', Capture);`], {type: 'text/javascript'}));
            await ac.audioWorklet.addModule(url); URL.revokeObjectURL(url);
            const capture = new AudioWorkletNode(ac, 'capture', {outputChannelCount: [2]});
            const samples = []; capture.port.onmessage = e => samples.push(...e.data);
            // Observe only nodes that still feed the real destination. In the
            // fixed core SDL's ScriptProcessor is a muted producer clock.
            let outputs = 0;
            for (const node of window.actualAudioOutputs) {
                try { node.disconnect(ac.destination); } catch { continue; }
                node.connect(capture); outputs++;
            }
            if (!outputs) throw Error('No actual audio output connected');
            capture.connect(ac.destination);
            const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
            await wait(400);
            for (let i = 0; i < 3; i++) {
                document.querySelector('canvas').click();
                const end = performance.now() + 350;
                while (performance.now() < end) {}
                await wait(160);
            }
            await wait(400);
            const rendered = samples.slice();
            window.native._onsyuri_host_set_paused(1);
            await wait(700);
            const paused = samples.slice(-8192);
            window.native._onsyuri_host_set_paused(0);
            await wait(600);
            const resumed = samples.slice(-8192);
            try { window.native._onsyuri_host_stop(); } catch (e) { if (e.name !== 'ExitStatus') throw e; }
            await wait(500);
            const stopped = samples.slice(-8192);
            capture.disconnect();
            return {rendered, paused, resumed, stopped, sampleRate: ac.sampleRate};
        });
        let audible = 0, replayed = 0, silent = 0, gap = 0, longestGap = 0;
        const firstAudible = result.rendered.findIndex(x => Math.abs(x) > .001);
        for (let i = firstAudible; i < result.rendered.length; i++) {
            gap = Math.abs(result.rendered[i]) < .00001 ? gap + 1 : 0;
            longestGap = Math.max(longestGap, gap);
        }
        for (let i = 8192; i + 512 < result.rendered.length; i += 128) {
            const block = result.rendered.slice(i, i + 512);
            if (block.every(x => Math.abs(x) < .00001)) { silent++; continue; }
            audible++;
            if (block.every((x, j) => x === result.rendered[i - 8192 + j])) replayed++;
        }
        const observation = {frames: result.rendered.length, audible, replayed, silent, sampleRate: result.sampleRate,
            longestGapMs: longestGap * 1000 / result.sampleRate};
        await fs.writeFile(path.join(output, caseId + '.json'), JSON.stringify(observation, null, 2));
        assert(audible > 100, 'empty or silent audio cannot establish an echo fix');
        assert.equal(replayed, 0, 'main-thread stalls replayed consumed audio');
        assert(observation.longestGapMs < 20, 'main-thread stalls interrupted continuous audio');
        assert(result.paused.every(x => x === 0), 'pause retained audible queued data');
        assert(result.resumed.some(x => Math.abs(x) > .001), 'audio did not resume');
        assert(result.stopped.every(x => x === 0), 'exit retained audible queued data');
        return observation;
    } });
cases.set('audio-loop-handoff', {script: define + `game\n*start\nbg #000000,1\nloopbgm "intro.wav","probe.wav"\n*wait\nclick\ngoto *wait\n`,
    verify: cases.get('audio-underrun').verify});
cases.set('sprite-font', { script: define + `game\n*start\nbg #000000,1\n` + windowScript + `spfont "serif.ttf",28,28,0,0,0,0\nlsp 10,":s#ffffffMMMM",20,20\nspfont clear\nlsp 11,":s/28,28,0;#ffffffMMMM",20,80\nprint 1\nclick\ngoto *start\n`, async verify(page) {
        const serif = await region(page, 20, 20, 180, 38), sans = await region(page, 20, 80, 180, 38);
        assert(serif.some(n => n > 128) && sans.some(n => n > 128), 'missing text sprites');
        assert.notDeepEqual(serif, sans, 'spfont did not change the rendered font');
        assert((await page.evaluate(() => window.reads)).some(r => r.name === 'serif.ttf'), 'font did not use content bridge');
    } });
cases.set('text-font', { script: define + `game\n*start\nbg #000000,1\n` + windowScript + `puttext "MMMM"\nfont "serif.ttf"\nclick\ntextclear\nputtext "MMMM"\nclick\nsetfont "default.ttf"\ntextclear\nputtext "MMMM"\nclick\ngoto *start\n`, async verify(page) {
        const first = await region(page, 16, 340, 150, 35);
        await page.screenshot({ path: path.join(output, 'font-first.png') });
        await advance(page);
        const second = await region(page, 16, 340, 150, 35);
        await page.screenshot({ path: path.join(output, 'font-second.png') });
        assert.notDeepEqual(second, first, 'font did not apply after clear');
        await advance(page);
        await page.screenshot({ path: path.join(output, 'font-third.png') });
        const third = await region(page, 16, 340, 150, 35);
        assert(third.every((n, i) => Math.abs(n - first[i]) <= 3), 'setfont did not restore the original face');
    } });
cases.set('menu-actions', { script: define + `resetmenu\ninsertmenu "Options",sub\ninsertmenu "Volume",dwavevolume,1\ninsertmenu "Version",version\ngame\n*start\nbg #000000,1\nclick\ngetmp3vol %1\nif %1!=23 goto *fail\ngetvoicevol %1\nif %1!=41 goto *fail\ngetsevol %1\nif %1!=57 goto *fail\n*success\n` + success, async verify(page) {
        const root = page.locator('[data-ons-menu]');
        await root.locator(':scope > summary').click();
        await root.locator('[data-ons-action="version"]').click();
        assert((await page.getByRole('dialog', { name: 'Version' }).innerText()).includes('ONS'));
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await root.locator(':scope > summary').click();
        await root.getByText('Options', { exact: true }).click();
        await root.locator('[data-ons-action="dwavevolume"]').click();
        for (const [label, value] of [['Music', 23], ['Voice', 41], ['Sound effects', 57]])
            await page.getByRole('slider', { name: label, exact: true }).fill(String(value));
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.waitForTimeout(100);
        await advance(page);
        assert.deepEqual(await pixel(page, 10, 10), [0, 170, 0, 255]);
    } });
cases.set('menu-lifecycle', { script: define + `killmenu 9\nkillmenu 0\ngame\n*start\nbg #000000,1\nclick\ndeletemenu\nclick\nresetmenu\ninsertmenu "Only",version\nclick\ngoto *start\n`, async verify(page) {
        const root = page.locator('[data-ons-menu]');
        assert.equal(await root.locator(':scope > div > *').count(), 8, 'legacy top-level indexes differ');
        assert.equal(await root.locator('[data-ons-action="full"]').count(), 0, 'killmenu retained descendants');
        assert.equal(await root.locator('[data-ons-action="end"]').count(), 0, 'killmenu 9 did not remove legacy Quit');
        await advance(page);
        assert.equal(await root.count(), 0, 'deletemenu did not remove UI');
        await advance(page);
        assert.equal(await root.locator('[data-ons-action]').count(), 1, 'resetmenu retained old entries');
    } });
cases.set('cursor-formats', { script: define + `mousecursor "cursor.cur"\ngame\n*start\nbg #000000,1\nclick\nmousecursor "cursor.ani"\nclick\nmousecursor "legacy.ani"\nclick\ngoto *start\n`, async verify(page) {
        const state = () => page.locator('canvas').evaluate(c => JSON.parse(c.dataset.onsCursor ?? 'null'));
        await page.waitForFunction(() => document.querySelector('canvas').dataset.onsCursor);
        assert.deepEqual(await state(), { frame: 0, frames: 1, width: 32, height: 32, x: 9, y: 10 });
        assert((await page.locator('canvas').evaluate(c => c.style.cursor)).includes('9 10'));
        await advance(page);
        await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.onsCursor).frames === 2);
        const seen = new Set();
        for (let i = 0; i < 8; i++) {
            seen.add((await state()).frame);
            await page.waitForTimeout(60);
        }
        assert.deepEqual([...seen].sort(), [0, 1], 'ANI frames did not animate');
        await advance(page);
        await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.onsCursor).frames === 1);
        assert.equal((await state()).x, 9);
        await page.evaluate(() => { try {
            window.native._onsyuri_host_stop();
        }
        catch (e) {
            if (e.name !== 'ExitStatus')
                throw e;
        } });
        assert.equal(await page.locator('[data-ons-menu]').count(), 0);
        assert.equal(await page.evaluate(() => !!window.native.onsCompatibility), false, 'exit retained UI state');
    } });
cases.set('errorsave', { script: define + `errorsave\ngame\n*start\nbg #000000,1\nclick\nchecksp %1,9999\nend\n`, allowDiagnostics: true, async verify(page) {
        await advance(page);
        await page.getByRole('dialog', { name: 'Game script error' }).waitFor();
        const files = await page.evaluate(() => ['save999.dat', 'save999.compat'].map(n => ({ name: n, size: window.native.FS.stat('/save/' + n).size })));
        assert(files.every(f => f.size > 0), 'empty diagnostic save');
        assert.equal(await page.getByRole('link', { name: 'Download diagnostic save', exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => window.native._onsyuri_host_checkpoint_ready()), 0, 'error dialog exposed resumable wait');
    } });
cases.set('audio-duck', { script: define + `bgmdownmode 1\ngame\n*start\nbg #000000,1\nbgm "music.wav"\nclick\ndwave 0,"voice.wav"\nclick\nbgmdownmode 0\ndwave 0,"voice.wav"\nclick\ngoto *start\n`, async verify(page) {
        const normal = await steadyTone(page, 700);
        assert(normal > -65, 'music is silent');
        await advance(page);
        await audible(page, 1100, 'voice never became audible');
        const ducked = await tone(page, 700), voice = await tone(page, 1100);
        assert(voice > -65, 'voice is silent');
        assert(ducked < normal - 4 && ducked > normal - 8, 'voice did not halve music gain');
        await page.waitForTimeout(2200);
        const restored = await tone(page, 700);
        assert(Math.abs(restored - normal) < 1.5, 'voice completion did not restore music');
        await advance(page);
        assert(Math.abs(await tone(page, 700) - normal) < 1.5, 'bgmdownmode 0 kept music ducked');
        return {normalDb: normal, duckedDb: ducked, voiceDb: voice, restoredDb: restored};
    } });
cases.set('cd-fade', { script: define + `cdfadeout 1200\ngame\n*start\nbg #000000,1\nplay "*1"\nclick\nplaystop\nbg #00aa00,1\nclick\ngoto *start\n`, async verify(page) {
        const normal = await steadyTone(page, 700);
        assert(normal > -65, 'simulated CD track is silent');
        const started = performance.now();
        await advance(page);
        const early = await tone(page, 700), earlyMs = performance.now() - started;
        await page.waitForTimeout(400);
        const late = await tone(page, 700), lateMs = performance.now() - started;
        assert(early < normal - 0.3 && late < early - 1.5 && late > -70,
            `CD track did not fade over time: ${JSON.stringify({normal, early, late, earlyMs, lateMs})}`);
        await page.waitForTimeout(1000);
        assert(await tone(page, 700) < -85, 'CD track did not stop');
        assert.deepEqual(await pixel(page, 10, 10), [0, 170, 0, 255], 'fade wait did not finish');
        return {normalDb: normal, earlyDb: early, lateDb: late, earlyMs, lateMs};
    } });
cases.set('state-restore', { script: define + `humanpos 100,320,540\nbtnnowindowerase\nnoteraseman\nbgmdownmode 1\ncdfadeout 500\nmousecursor "cursor.cur"\nresetmenu\ninsertmenu "Parent",sub\ngame\n*start\nbg #000000,1\n` + windowScript + `font "default.ttf"\nspfont "serif.ttf",28,28,0,0,0,0\nlsp 10,":s#ffffffMMMM",20,20\nspfont clear\nlsp 11,":s/28,28,0;#ffffffMMMM",20,80\nprint 1\nfont "serif.ttf"\n` + '`FIRST@\n' + `insertmenu "Child",version,1\nld l,":c;human.bmp",1\n` + '`SECOND@\n' + `goto *start\n`, async verify(page) {
        await page.waitForFunction(() => window.native._onsyuri_host_checkpoint_ready() === 1);
        const before = await region(page, 0, 0, 640, 480);
        const files = await page.evaluate(() => { const m = window.native; m._onsyuri_host_set_paused(1); try {
            if (m._onsyuri_host_save(999) !== 0)
                throw Error('capture failed');
            return m.FS.readdir('/save').filter(n => n !== '.' && n !== '..').map(path => ({ path, data: Array.from(m.FS.readFile('/save/' + path)) }));
        }
        finally {
            m._onsyuri_host_set_paused(0);
        } });
        assert(files.some(f => f.path === 'save999.compat' && f.data.length > 16), 'companion absent');
        restorations.set('state-restore', files);
        await page.reload();
        await page.waitForFunction(() => window.failure || window.native?._onsyuri_host_checkpoint_ready() === 1 || window.native?._onsyuri_host_did_restore_fail() === 1);
        assert.equal(await page.evaluate(() => window.native._onsyuri_host_did_restore_fail()), 0, 'valid companion rejected');
        const after=await region(page,0,0,640,480);assert(after.every((n,i)=>Math.abs(n-before[i])<=3),'text or sprite fonts changed on new instance');
        await advance(page);
        await page.waitForFunction(() => window.native._onsyuri_host_checkpoint_ready() === 1);
        assert.equal(await page.locator('[data-ons-action="version"]').count(), 1, 'restored menu parent was lost');
        const person = await pixel(page, 100, 450);
        assert(person[1] > 20 && person[0] === 0, 'restored humanpos was lost');
        const corrupt = structuredClone(files);
        corrupt.find(f => f.path === 'save999.compat').data[8] ^= 1;
        restorations.set('state-restore', corrupt);
        await page.reload();
        await page.waitForFunction(() => window.failure || window.native?._onsyuri_host_did_restore_fail() === 1);
        assert.equal(await page.evaluate(() => window.native._onsyuri_host_did_restore_fail()), 1, 'mismatched native-save binding accepted');
    } });
cases.set('lookback-voice', { script: define + `lookbackvoice "flip.wav"\ngame\n*start\nbg #000000,1\n` + windowScript + ['`FIRST\\', '`SECOND\\', '`THIRD@', 'goto *start', ''].join('\n'), async verify(page) {
        await advance(page);
        await advance(page);
        await page.locator('canvas').focus();
        await page.mouse.move(400, 400);
        await page.mouse.wheel(0, -120);
        await audible(page, 1700, 'lookback entry did not play the page sound');
        await page.waitForTimeout(700);
        await page.mouse.wheel(0, -120);
        await audible(page, 1700, 'lookback page change did not play the page sound');
        assert(!(await page.evaluate(() => window.reads)).some(r => /wav.*voice/.test(r.name)), 'lookback replayed story voice');
    } });
// The CD fixture must outlast startup and its 1.2-second fade; natural track end is not a fade failure.
const common = new Map([["default.ttf", await fs.readFile(sans)], ["serif.ttf", await fs.readFile(serif)], ["human.bmp", bmp(20, 100, [0, 255, 0])], ["cursor.cur", cur([0, 255, 0])], ["cursor.ani", ani()], ["legacy.ani", ani(true)], ["music.wav", wav(700, 1)], ["cd/track01.wav", wav(700, 5)], ["voice.wav", wav(1100, 2)], ["flip.wav", wav(1700, .6)], ['probe.wav', audioProbe()], ['intro.wav', wav(700, 1.45)]]);
const coreFiles = new Map(await Promise.all(["onsyuri.js", "onsyuri.wasm"].map(async (name) => [name, await fs.readFile(path.join(assets, name))])));
const selected = process.env.ONS_CASES?.split(",");
const report = { inputs: { core: [...coreFiles].map(([name, bytes]) => ({ name, sha256: sha(bytes), sizeBytes: bytes.length })), resources: [...common].map(([name, bytes]) => ({ name, sha256: sha(bytes) })) }, cases: [] };
const restorations = new Map();
const html = id => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="canvas" tabindex="0"></canvas><script src="/onsyuri.js"></script><script>
window.flush_save=()=>{};window.scale_full=()=>{};window.playVideo=()=>{};
const originalConnect=AudioNode.prototype.connect;window.actualAudioOutputs=new Set();
AudioNode.prototype.connect=function(target,...args){if(target===this.context.destination){
    window.actualAudioOutputs.add(this);window.actualAudioContext=this.context;
    if(!window.audioAnalyser){window.audioAnalyser=this.context.createAnalyser();window.audioAnalyser.fftSize=8192;window.audioAnalyser.smoothingTimeConstant=0;window.audioSampleRate=this.context.sampleRate;}
    originalConnect.call(this,window.audioAnalyser);
}return originalConnect.call(this,target,...args)};
(async()=>{
const names=await(await fetch('/files/${id}')).json();const files=new Map(await Promise.all(names.map(async name=>['/game/'+name,{name,bytes:new Uint8Array(await(await fetch('/source/${id}/'+name)).arrayBuffer())}])));
const handles=new Map();let next=1;window.reads=[];
const read=(h,o,n)=>{const f=handles.get(h);window.reads.push({name:f.name,offset:o,length:n});return f.bytes.slice(o,o+n)};
window.g_onsyuri_content={abi:'ons-content-io-v1',async open(p){const f=files.get(p.replaceAll('\\\\','/'));if(!f)return 0;const h=next++;handles.set(h,f);return h},size:h=>handles.get(h).bytes.length,tryRead:(h,o,n)=>o===0?null:read(h,o,n),async read(h,o,n){await new Promise(r=>setTimeout(r,0));return read(h,o,n)},close:h=>handles.delete(h)};
const canvas=document.getElementById('canvas'),get=canvas.getContext.bind(canvas);canvas.getContext=(t,o)=>get(t,/webgl/i.test(t)?{...o,preserveDrawingBuffer:true}:o);
const m=await onsyuri({canvas,locateFile:n=>'/'+n,printErr:t=>console.debug(t)});window.native=m;m.FS.mkdirTree('/game');m.FS.mkdirTree('/save');
const restored=await(await fetch('/restore/${id}')).json();for(const f of restored)m.FS.writeFile('/save/'+f.path,new Uint8Array(f.data));m._onsyuri_host_set_restore_slot(restored.length?999:-1);
m.callMain(['--root','/game','--font','/game/default.ttf','--save-dir','/save','--enc:utf8']);canvas.focus();
})().catch(e=>window.failure=String(e.stack||e));</script>`;
const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    let bytes, type = "application/octet-stream";
    const parts = req.url.split("/").filter(Boolean);
    if (parts[0] === "case" && cases.has(parts[1])) {
        bytes = Buffer.from(html(parts[1]));
        type = "text/html";
    }
    else if (parts[0] === "restore") {
        bytes = Buffer.from(JSON.stringify(restorations.get(parts[1]) ?? []));
        type = "application/json";
    }
    else if (parts[0] === "files" && cases.has(parts[1])) {
        bytes = Buffer.from(JSON.stringify(["0.txt", ...common.keys()]));
        type = "application/json";
    }
    else if (parts[0] === "source" && cases.has(parts[1]))
        bytes = parts[2] === "0.txt" ? Buffer.from(cases.get(parts[1]).script) : common.get(parts.slice(2).join("/"));
    else if (coreFiles.has(parts[0])) {
        bytes = coreFiles.get(parts[0]);
        type = parts[0].endsWith(".wasm") ? "application/wasm" : "text/javascript";
    }
    if (!bytes) {
        res.writeHead(req.url === "/favicon.ico" ? 204 : 404);
        res.end();
        return;
    }
    res.setHeader("Content-Type", type);
    res.end(bytes);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: browserExecutable, headless: true, args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
async function audible(page, hz, message) {
    for (let i = 0; i < 12; i++) {
        if (await tone(page, hz) > -65)
            return;
    }
    assert.fail(message);
}
async function steadyTone(page, hz) {
    // Core readiness precedes asynchronous audio reads and the first FFT window.
    // Establish an audible, stable baseline before changing the actual mixer gain.
    let previous = -Infinity, stable = 0;
    for (let i = 0; i < 24; i++) {
        const value = await tone(page, hz);
        stable = value > -65 && Math.abs(value - previous) < 0.3 ? stable + 1 : 0;
        if (stable >= 2) return value;
        previous = value;
    }
    assert.fail('audio did not reach a stable audible baseline');
}
async function tone(page, hz) {
    await page.waitForTimeout(120);
    return page.evaluate(hz => { const a = window.audioAnalyser; if (!a)
        throw Error('No actual audio output'); const f = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(f); const bin = Math.round(hz * a.fftSize / window.audioSampleRate); return Math.max(...f.slice(bin - 2, bin + 3)); }, hz);
}
async function advance(page) {
    await page.locator("canvas").click({ position: { x: 600, y: 250 } });
    await page.waitForTimeout(180);
}
async function pixel(page, x, y) {
    return page.evaluate(({ x, y }) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const ctx = c.getContext('2d'); ctx.drawImage(window.native.canvas, 0, 0); return Array.from(ctx.getImageData(x, y, 1, 1).data); }, { x, y });
}
async function region(page, x, y, width, height) {
    return page.evaluate(({ x, y, width, height }) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const ctx = c.getContext('2d'); ctx.drawImage(window.native.canvas, 0, 0); const b = ctx.getImageData(x, y, width, height).data; return Array.from(b).filter((_, i) => i % 4 !== 3); }, { x, y, width, height });
}
try {
    for (const [id, entry] of cases) {
        if (selected && !selected.includes(id))
            continue;
        const page = await browser.newPage({ viewport: { width: 640, height: 480 } }), result = { id, scriptSha256: sha(Buffer.from(entry.script)), console: [], errors: [] };
        page.on("console", m => { if (result.console.length < 400)
            result.console.push(m.text()); });
        page.on("pageerror", e => result.errors.push(e.message));
        try {
            await page.goto(`http://127.0.0.1:${server.address().port}/case/${id}`);
            await page.waitForFunction(() => window.failure || window.native?._onsyuri_host_is_ready() === 1, null, { timeout: 30000 });
            assert.equal(await page.evaluate(() => window.failure ?? null), null);
            await page.waitForTimeout(300);
            const observations = await entry.verify(page, id);
            if (observations) result.observations = observations;
            assert.deepEqual(result.errors, []);
            if (!entry.allowDiagnostics)
                assert(!result.console.some(x => /command .*not supported yet|Parse error|Script error/.test(x)), "script diagnostics");
            result.status = "PASS";
        }
        catch (e) {
            result.status = "FAIL";
            result.reason = String(e.stack || e);
        }
        await page.screenshot({ path: path.join(output, id + ".png") }).catch(() => { });
        result.reads = await page.evaluate(() => window.reads ?? []).catch(() => []);
        await page.evaluate(() => window.native?._onsyuri_host_stop()).catch(() => { });
        await page.close();
        report.cases.push(result);
        console.log(JSON.stringify({ case: id, status: result.status, reason: result.reason?.split("\n")[0] }));
    }
}
finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
if (report.cases.some(x => x.status !== "PASS"))
    process.exitCode = 1;
