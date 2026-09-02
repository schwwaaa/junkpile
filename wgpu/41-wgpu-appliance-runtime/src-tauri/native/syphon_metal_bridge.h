#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void* junkpile_syphon_server_create(const char* name_utf8);
void  junkpile_syphon_server_destroy(void* server_ptr);
int32_t junkpile_syphon_server_has_clients(void* server_ptr);
int32_t junkpile_syphon_server_publish_bgra(
    void* server_ptr,
    const uint8_t* bytes,
    uint32_t width,
    uint32_t height,
    uint32_t bytes_per_row
);

#ifdef __cplusplus
}
#endif
