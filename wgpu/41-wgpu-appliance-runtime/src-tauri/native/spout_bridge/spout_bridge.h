#pragma once

#include <stdint.h>

#ifdef _WIN32
#define JUNKPILE_SPOUT_API __declspec(dllexport)
#else
#define JUNKPILE_SPOUT_API
#endif

extern "C" {
JUNKPILE_SPOUT_API int junkpile_spout_sender_create(const char* sender_name_utf8, int adapter_index);
JUNKPILE_SPOUT_API int junkpile_spout_sender_send_bgra(
    const uint8_t* bytes,
    uint32_t width,
    uint32_t height,
    uint32_t bytes_per_row);
JUNKPILE_SPOUT_API void junkpile_spout_sender_release();
JUNKPILE_SPOUT_API int64_t junkpile_spout_sender_frame();
JUNKPILE_SPOUT_API double junkpile_spout_sender_fps();
}
