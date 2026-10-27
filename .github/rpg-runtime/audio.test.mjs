// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../../src/onsyuri_web/audio.js', import.meta.url), 'utf8');
function fixture(hooks = {}) {
    const nodes = [], buffers = [], finished = [], heap = new Int16Array(80);
    for (let i = 0; i < heap.length; i++) heap[i] = i % 2 ? -i * 100 : i * 100;
    const node = () => ({connections: [], connect(target) { this.connections.push(target); },
        disconnect() { this.connections = []; }});
    const context = {currentTime: 0, destination: {},
        createGain() {
            return {...node(), gain: {events: [], cancelScheduledValues(t) { this.events.push(['cancel', t]); },
                setValueAtTime(v, t) { this.events.push(['set', v, t]); },
                linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); }}};
        },
        createBuffer(channels, length, rate) {
            const data = Array.from({length: channels}, () => new Float32Array(length));
            const buffer = {duration: length / rate, getChannelData: c => data[c]};
            buffers.push(buffer); return buffer;
        },
        createBufferSource() {
            const source = {...node(), stops: [], start(when, offset) { this.when = when; this.offset = offset; },
                stop(when = 0) { this.stops.push(when); }};
            nodes.push(source); return source;
        }};
    const producer = {...node(), onaudioprocess() { assert.fail('main thread must not supply playback PCM'); }};
    producer.connect(context.destination);
    const Module = {...hooks, _ons_web_audio_finished: channel => finished.push(channel)};
    vm.runInNewContext(source, {Module, HEAP16: heap, Map, Number, Math, Infinity});
    const audio = Module.onsAudio;
    audio.open(context, producer); audio.allocate(4);
    const load = id => audio.load(id, 0, heap.byteLength, 4, 2);
    return {audio, context, producer, nodes, buffers, heap, finished, Module, load};
}

test('SDL PCM is copied as stereo and playback has no main-thread producer', () => {
    const f = fixture();
    assert.equal(f.producer.onaudioprocess, null);
    assert.equal(f.producer.connections.length, 0);
    assert.equal(f.load('voice'), 1);
    assert.equal(f.audio.play(0, 'voice', 0), 0);
    assert.equal(f.nodes[0].buffer, f.buffers[0]);
    assert.equal(f.buffers[0].getChannelData(0)[1], 200 / 32768);
    assert.equal(f.buffers[0].getChannelData(1)[1], -300 / 32768);
    f.heap.fill(0);
    assert.equal(f.buffers[0].getChannelData(0)[1], 200 / 32768);
    f.context.currentTime = .35;
    assert.equal(f.audio.playing(0), 1);
    assert.equal(f.nodes.length, 1, 'elapsed time requires no refill or rescheduling');
});

test('replacing a voice suppresses stale completion and releasing old PCM preserves the replacement', () => {
    const f = fixture(); f.load('old'); f.load('new');
    f.audio.play(0, 'old', 0);
    const ended = f.nodes[0].onended;
    f.audio.play(0, 'new', 0);
    ended(); f.audio.release('old');
    assert.equal(f.audio.playing(0), 1);
    assert.equal(f.nodes[0].onended, null);
    assert.deepEqual(f.finished, []);
    f.nodes[1].onended();
    assert.equal(f.audio.playing(0), 0);
    assert.deepEqual(f.finished, [0]);
});

test('host and per-channel pause preserve position and do not resume locally paused channels', () => {
    const f = fixture(); f.load('clip');
    f.audio.play(0, 'clip', 0); f.audio.play(1, 'clip', -1);
    f.context.currentTime = 2;
    f.audio.pause(1, true); f.audio.setPaused(true);
    assert.equal(f.audio.playing(-1), 2, 'SDL counts paused channels as playing');
    f.context.currentTime = 20;
    f.audio.setPaused(false);
    assert.equal(f.nodes.length, 3);
    assert.equal(f.nodes[2].offset, 2);
    assert.equal(f.nodes[2].stops[0], 28);
    f.audio.pause(1, false);
    assert.equal(f.nodes.length, 4);
    assert.equal(f.nodes[3].offset, 2);
    assert.equal(f.nodes[3].loop, true);
});

test('finite and infinite loops, music seek, free-channel selection and volume remain independent', () => {
    const f = fixture(); f.load('clip');
    assert.equal(f.audio.play(-1, 'missing', 0), -1);
    assert.equal(f.audio.play(-1, 'clip', 1), 0);
    assert.equal(f.nodes[0].loop, true);
    assert.equal(f.nodes[0].stops[0], 20);
    assert.equal(f.audio.play(-1, 'clip', 0), 1);
    assert.equal(f.audio.play('music', 'clip', -1), 0);
    assert.equal(f.audio.seek(3), 0);
    assert.equal(f.nodes.at(-1).offset, 3);
    assert.equal(f.audio.volume(0, 32), 128);
    assert.equal(f.audio.volume(0, -1), 32);
    assert.equal(f.audio.volume('music', -1), 128);
    assert.equal(f.audio.volume(-1, 64), 104);
    assert.equal(f.audio.volume('music', -1), 128);
    f.audio.halt(-1);
    assert.equal(f.audio.playing(-1), 0);
    assert.equal(f.audio.playing('music'), 1);
});

test('fades are scheduled on the audio clock and volume updates preserve the deadline', () => {
    const f = fixture(); f.load('clip'); f.audio.play('music', 'clip', -1);
    assert.equal(f.audio.fade('music', 3000), 1);
    const faded = f.nodes.at(-1), gain = faded.connections[0].gain;
    assert.equal(faded.stops[0], 3);
    assert.deepEqual(gain.events.at(-1), ['ramp', 0, 3]);
    f.context.currentTime = 1;
    f.audio.volume('music', 64);
    assert.deepEqual(gain.events.at(-1), ['ramp', 0, 3]);
    assert(Math.abs(gain.events.at(-2)[1] - 1 / 3) < 1e-10);
    faded.onended();
    assert.deepEqual(f.finished, [-1]);
});

test('a music loop offset cancels the original one-shot deadline', () => {
    const f = fixture(); f.load('clip'); f.audio.play('music', 'clip', 0);
    f.audio.musicLoop(true, 2);
    const loop = f.nodes.at(-1);
    assert.equal(f.nodes[0].onended, null);
    assert.equal(loop.loop, true);
    assert.equal(loop.loopStart, 2);
    assert.deepEqual(loop.stops, []);
    f.context.currentTime = 30;
    assert.equal(f.audio.playing('music'), 1);
});

test('intro-to-loop handoff is scheduled before the main-thread completion callback', () => {
    const f = fixture(); f.load('intro'); f.load('loop');
    f.audio.play(2, 'intro', 0);
    f.audio.chain(2, 3, 'loop');
    assert.equal(f.nodes[1].when, 10);
    assert.equal(f.nodes[1].loop, true);
    f.context.currentTime = 4;
    f.audio.setPaused(true);
    f.context.currentTime = 20;
    f.audio.setPaused(false);
    assert.equal(f.nodes[2].offset, 4);
    assert.equal(f.nodes[3].when, 26, 'pause must retain the remaining intro-to-loop delay');
    f.context.currentTime = 27;
    assert.equal(f.audio.playing(3), 1);
    f.audio.release('intro');
    assert.equal(f.audio.playing(3), 1);
});

test('reset, exit and abort stop sources, release buffers and chain host callbacks', () => {
    for (const hook of ['onExit', 'onAbort']) {
        let called;
        const f = fixture({[hook]: value => {
            called = value;
            assert.equal(f.audio.playing(-1), 0, 'cleanup must precede the host callback');
        }});
        f.load('clip'); f.audio.play(0, 'clip', -1);
        f.audio.reset();
        assert.equal(f.nodes[0].onended, null);
        assert.equal(f.audio.playing(-1), 0);
        f.audio.play(0, 'clip', -1);
        f.Module[hook](42);
        assert.equal(called, 42);
        assert.equal(f.nodes[1].onended, null);
        assert.equal(f.nodes[1].connections.length, 0);
        assert.equal(f.producer.onaudioprocess, null);
        assert.equal(f.audio.play(0, 'clip', 0), -1);
    }
});

test('clip ownership and allocation limits are explicit; released memory can be reused', () => {
    const f = fixture();
    assert.equal(f.load('clip'), 1);
    assert.equal(f.load('clip'), 0);
    assert.equal(f.audio.load('huge', 0, 256 * 1024 * 1024, 4, 2), 0);
    assert.equal(f.audio.load('partial', 0, 3, 4, 2), 0);
    f.audio.release('clip');
    assert.equal(f.load('clip'), 1);
    f.audio.close();
    assert.equal(f.load('closed'), 0);
});
