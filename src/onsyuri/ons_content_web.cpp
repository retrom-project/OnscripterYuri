/* -*- C++ -*-
 *
 *  ons_content_web.cpp - on-demand project file reads for the Web build
 *
 *  Project files are not copied into the Emscripten file system. fopen()
 *  returns a read-only stdio stream backed by the host content bridge
 *  (window.g_onsyuri_content, ABI "ons-content-io-v1"), so reading an
 *  archive such as arc.nsa fetches only the byte ranges the engine uses.
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 */

#if defined(WEB)
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <emscripten.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>

#undef fopen

// stdio drops its buffer on every seek, so a large buffer multiplies FreeType's small random reads.
// Large engine reads (archive entries, images) bypass the buffer and go straight to the bridge.
static const size_t stream_buffer_bytes = 32 * 1024;

EM_JS(int, ons_content_available, (), {
    var bridge = typeof g_onsyuri_content === "object" ? g_onsyuri_content : null;
    return bridge && bridge.abi === "ons-content-io-v1" ? 1 : 0;
});

// Returns a positive handle, 0 when the path is not a project file, or -1 on failure.
EM_ASYNC_JS(int, ons_content_open, (const char *path, double *size), {
    var handle = await g_onsyuri_content.open(UTF8ToString(path));
    if (handle > 0) HEAPF64[size >> 3] = g_onsyuri_content.size(handle);
    return handle;
});

// Synchronous hot-cache probe: the bytes read, or -1 when they are not all cached.
EM_JS(int, ons_content_try_read, (int handle, double offset, char *buffer, int length), {
    var bytes = g_onsyuri_content.tryRead(handle, offset, length);
    if (!bytes) return -1;
    HEAPU8.set(bytes, buffer);
    return bytes.length;
});

EM_ASYNC_JS(int, ons_content_read, (int handle, double offset, char *buffer, int length), {
    var bytes = await g_onsyuri_content.read(handle, offset, length);
    if (!bytes) return -1;
    HEAPU8.set(bytes, buffer);
    return bytes.length;
});

EM_JS(void, ons_content_close, (int handle), {
    g_onsyuri_content.close(handle);
});

struct ContentStream {
    int handle;
    off_t size;
    off_t position;
    char *buffer;
};

static ssize_t content_read(void *cookie, char *buffer, size_t size)
{
    ContentStream *stream = (ContentStream *)cookie;
    if (size == 0 || stream->position >= stream->size) return 0;
    off_t remaining = stream->size - stream->position;
    size_t wanted = (off_t)size < remaining ? size : (size_t)remaining;
    if (wanted > INT_MAX) wanted = INT_MAX;
    int length = (int)wanted;
    int read = ons_content_try_read(stream->handle, (double)stream->position, buffer, length);
    if (read < 0) read = ons_content_read(stream->handle, (double)stream->position, buffer, length);
    if (read < 0) {
        errno = EIO;
        return -1;
    }
    stream->position += read;
    return read;
}

static int content_seek(void *cookie, off_t *offset, int whence)
{
    ContentStream *stream = (ContentStream *)cookie;
    off_t base;
    switch (whence) {
    case SEEK_SET: base = 0; break;
    case SEEK_CUR: base = stream->position; break;
    case SEEK_END: base = stream->size; break;
    default: errno = EINVAL; return -1;
    }
    off_t target = base + *offset;
    if (target < 0) {
        errno = EINVAL;
        return -1;
    }
    stream->position = target;
    *offset = target;
    return 0;
}

static int content_close(void *cookie)
{
    ContentStream *stream = (ContentStream *)cookie;
    ons_content_close(stream->handle);
    free(stream->buffer);
    free(stream);
    return 0;
}

static FILE *open_content(const char *path)
{
    double size = 0;
    int handle = ons_content_open(path, &size);
    if (handle <= 0) {
        errno = handle == 0 ? ENOENT : EIO;
        return NULL;
    }
    ContentStream *stream = (ContentStream *)calloc(1, sizeof(ContentStream));
    char *buffer = (char *)malloc(stream_buffer_bytes);
    cookie_io_functions_t functions = {content_read, NULL, content_seek, content_close};
    FILE *fp = stream && buffer ? fopencookie(stream, "rb", functions) : NULL;
    if (!fp) {
        free(buffer);
        free(stream);
        ons_content_close(handle);
        errno = ENOMEM;
        return NULL;
    }
    stream->handle = handle;
    stream->size = (off_t)size;
    stream->buffer = buffer;
    setvbuf(fp, buffer, _IOFBF, stream_buffer_bytes);
    return fp;
}

extern "C" FILE *fopen_ons(const char *path, const char *mode)
{
    // Saves and other engine-written files live in the Emscripten file system.
    FILE *fp = fopen(path, mode);
    if (fp) return fp;
    bool read_only = strcmp(mode, "r") == 0 || strcmp(mode, "rb") == 0;
    if (!read_only || !ons_content_available()) return NULL;
    return open_content(path);
}
#endif
