// SPDX-License-Identifier: GPL-2.0-or-later
// SDL decodes supported formats. The browser renders independent clip sources,
// so script, image and text work cannot starve or replay a shared PCM stream.
(function () {
    const clips = new Map(), tracks = new Map(), volumes = new Map();
    const maximumClipBytes = 256 * 1024 * 1024;
    const maximumTotalBytes = 512 * 1024 * 1024;
    let context = null, destination = null, source = null;
    let retainedBytes = 0, channelCount = 0, paused = false, hooked = false;

    function interrupt(track) {
        if (!track.node) return;
        track.node.onended = null;
        track.node.stop();
        track.node.disconnect();
        track.node = null;
    }
    function remove(channel, notify) {
        const track = tracks.get(channel);
        if (!track) return;
        tracks.delete(channel);
        interrupt(track);
        track.gain.disconnect();
        if (notify) Module['_ons_web_audio_finished'](channel === 'music' ? -1 : channel);
    }
    function reset() {
        for (const channel of tracks.keys()) remove(channel, false);
    }
    function close() {
        reset();
        clips.clear(); volumes.clear(); retainedBytes = 0;
        if (destination) destination.disconnect();
        if (source) { source.onaudioprocess = null; source.disconnect(); }
        destination = context = source = null;
    }
    function fadeLevel(track) {
        if (!track.fade) return 1;
        if (track.fade.begin === null) return track.fade.level;
        return track.fade.level * Math.max(0, 1 - (context.currentTime - track.fade.begin) / track.fade.duration);
    }
    function setGain(channel, track) {
        const now = context.currentTime, value = (volumes.get(channel) ?? 128) / 128;
        track.gain.gain.cancelScheduledValues(now);
        track.gain.gain.setValueAtTime(value * fadeLevel(track), now);
        if (track.fade && track.fade.begin !== null) {
            track.gain.gain.linearRampToValueAtTime(0, Math.max(now, track.fade.begin + track.fade.duration));
        }
    }
    function freeze(track) {
        if (!track.node) return;
        track.delay = Math.max(0, track.started - context.currentTime);
        const elapsed = Math.max(0, context.currentTime - track.started);
        track.offset = (track.offset + elapsed) % clips.get(track.clip).buffer.duration;
        track.remaining = Math.max(0, track.remaining - elapsed);
        if (track.fade) {
            track.fade.level = fadeLevel(track);
            track.fade.duration = Math.max(0, track.fade.duration - elapsed);
            track.fade.begin = null;
        }
        interrupt(track);
    }
    function start(channel, track) {
        if (paused || track.paused) return;
        const buffer = clips.get(track.clip).buffer, node = context.createBufferSource();
        node.buffer = buffer;
        node.loop = track.loops !== 0;
        node.loopStart = track.loopStart;
        node.loopEnd = buffer.duration;
        track.node = node;
        track.started = context.currentTime + track.delay;
        track.delay = 0;
        if (track.fade) track.fade.begin = track.started;
        setGain(channel, track);
        node.connect(track.gain);
        node.onended = function () {
            if (tracks.get(channel) === track && track.node === node) remove(channel, true);
        };
        node.start(track.started, track.offset);
        const until = Math.min(track.remaining, track.fade ? track.fade.duration : Infinity);
        if (Number.isFinite(until)) node.stop(track.started + until);
    }
    function each(channel, callback) {
        if (channel === -1) {
            for (const [key, track] of tracks) if (typeof key === 'number') callback(key, track);
        } else if (tracks.has(channel)) callback(channel, tracks.get(channel));
    }
    const audio = Module['onsAudio'] = {
        open: function (audioContext, producer) {
            close();
            context = audioContext; source = producer;
            // SDL remains available for format conversion, never for playback.
            source.disconnect(); source.onaudioprocess = null;
            destination = context.createGain(); destination.connect(context.destination);
            if (!hooked) {
                hooked = true;
                for (const name of ['onExit', 'onAbort']) {
                    const previous = Module[name];
                    Module[name] = function (value) { close(); if (previous) previous(value); };
                }
            }
        },
        load: function (id, address, bytes, rate, channels) {
            const frames = bytes / (2 * channels), size = frames * channels * 4;
            if (!context || !Number.isInteger(frames) || frames < 1 || size > maximumClipBytes ||
                retainedBytes + size > maximumTotalBytes || clips.has(id)) return 0;
            try {
                const buffer = context.createBuffer(channels, frames, rate);
                for (let c = 0; c < channels; c++) {
                    const output = buffer.getChannelData(c);
                    for (let i = 0; i < frames; i++) output[i] = HEAP16[(address >> 1) + i * channels + c] / 32768;
                }
                clips.set(id, {buffer, size}); retainedBytes += size;
                return 1;
            } catch (error) { return 0; }
        },
        release: function (id) {
            for (const [channel, track] of tracks) if (track.clip === id) remove(channel, false);
            const clip = clips.get(id);
            if (clip) { retainedBytes -= clip.size; clips.delete(id); }
        },
        allocate: function (count) { channelCount = count; },
        play: function (channel, clip, loops, delay = 0) {
            if (!context || !clips.has(clip)) return -1;
            if (channel === -1) {
                for (channel = 0; channel < channelCount && tracks.has(channel); channel++) {}
                if (channel === channelCount) return -1;
            }
            remove(channel, false);
            const buffer = clips.get(clip).buffer, gain = context.createGain();
            gain.connect(destination);
            const track = {clip, gain, node: null, loops, delay, offset: 0, loopStart: 0, paused: false,
                fade: null, started: 0, remaining: loops < 0 ? Infinity : buffer.duration * (loops + 1)};
            tracks.set(channel, track);
            start(channel, track);
            return channel === 'music' ? 0 : channel;
        },
        chain: function (introChannel, loopChannel, clip) {
            const intro = tracks.get(introChannel);
            if (!intro) return;
            const elapsed = intro.node ? Math.max(0, context.currentTime - intro.started) : 0;
            audio.play(loopChannel, clip, -1, Math.max(0, intro.remaining - elapsed));
        },
        playing: function (channel) {
            let count = 0;
            each(channel, (key, track) => {
                if (!track.node || track.remaining > context.currentTime - track.started) count++;
            });
            return count;
        },
        pause: function (channel, value) {
            each(channel, (key, track) => {
                if (track.paused === value) return;
                track.paused = value;
                if (value) freeze(track); else start(key, track);
            });
        },
        volume: function (channel, value) {
            if (channel === -1) {
                let previous = 0;
                for (let c = 0; c < channelCount; c++) previous += audio.volume(c, value);
                return channelCount ? Math.floor(previous / channelCount) : 0;
            }
            const previous = volumes.get(channel) ?? 128;
            if (value >= 0) {
                volumes.set(channel, Math.min(128, value));
                if (tracks.has(channel)) setGain(channel, tracks.get(channel));
            }
            return previous;
        },
        fade: function (channel, milliseconds) {
            let count = 0;
            each(channel, (key, track) => {
                count++;
                if (milliseconds <= 0) { remove(key, true); return; }
                freeze(track);
                track.fade = {level: 1, duration: milliseconds / 1000, begin: null};
                start(key, track);
            });
            return count;
        },
        seek: function (seconds) {
            const track = tracks.get('music');
            if (!track || !Number.isFinite(seconds) || seconds < 0) return -1;
            const duration = clips.get(track.clip).buffer.duration;
            freeze(track); track.offset = seconds % duration;
            if (track.loops >= 0) track.remaining = Math.max(0, duration - track.offset);
            start('music', track); return 0;
        },
        musicLoop: function (loop, offset) {
            const track = tracks.get('music');
            if (!track || !loop) return;
            const restart = track.loops >= 0;
            if (restart) freeze(track);
            track.loops = -1; track.remaining = Infinity;
            track.loopStart = Math.max(0, Math.min(offset, clips.get(track.clip).buffer.duration));
            if (restart) start('music', track);
            if (track.node) { track.node.loop = true; track.node.loopStart = track.loopStart; }
        },
        halt: function (channel) { each(channel, key => remove(key, false)); },
        setPaused: function (value) {
            if (paused === value) return;
            paused = value;
            for (const [key, track] of tracks) if (value) freeze(track); else start(key, track);
        },
        reset,
        close,
    };
})();
