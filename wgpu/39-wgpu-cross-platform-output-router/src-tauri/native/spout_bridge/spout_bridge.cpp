#include "spout_bridge.h"

#include <memory>
#include <mutex>
#include <string>

#include "SpoutDX.h"

namespace {
std::mutex g_mutex;
std::unique_ptr<spoutDX> g_sender;
std::string g_sender_name;

void release_locked() {
    if (g_sender) {
        g_sender->ReleaseSender();
        g_sender->CloseDirectX11();
        g_sender.reset();
    }
    g_sender_name.clear();
}
}

extern "C" {

int junkpile_spout_sender_create(const char* sender_name_utf8, int adapter_index) {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        release_locked();

        const char* requested =
            (sender_name_utf8 && *sender_name_utf8) ? sender_name_utf8 : "Junkpile 38";
        auto sender = std::make_unique<spoutDX>();
        if (adapter_index >= 0 && !sender->SetAdapter(adapter_index)) {
            return 0;
        }
        if (!sender->OpenDirectX11() || sender->GetDX11Device() == nullptr) {
            return 0;
        }
        sender->SetSenderFormat(DXGI_FORMAT_B8G8R8A8_UNORM);
        if (!sender->SetSenderName(requested)) {
            return 0;
        }

        g_sender_name = requested;
        g_sender = std::move(sender);
        return 1;
    }
    catch (...) {
        release_locked();
        return 0;
    }
}

int junkpile_spout_sender_send_bgra(
    const uint8_t* bytes,
    uint32_t width,
    uint32_t height,
    uint32_t bytes_per_row) {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        if (!g_sender || !bytes || width == 0 || height == 0) {
            return 0;
        }
        const unsigned int pitch = bytes_per_row > 0 ? bytes_per_row : width * 4u;
        return g_sender->SendImage(bytes, width, height, pitch) ? 1 : 0;
    }
    catch (...) {
        return 0;
    }
}

void junkpile_spout_sender_release() {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        release_locked();
    }
    catch (...) {
    }
}

int64_t junkpile_spout_sender_frame() {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        return g_sender ? static_cast<int64_t>(g_sender->GetFrame()) : 0;
    }
    catch (...) {
        return 0;
    }
}

double junkpile_spout_sender_fps() {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        return g_sender ? g_sender->GetFps() : 0.0;
    }
    catch (...) {
        return 0.0;
    }
}

}
