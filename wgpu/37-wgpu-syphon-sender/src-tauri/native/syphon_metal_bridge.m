#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <Syphon/SyphonMetalServer.h>

#import "syphon_metal_bridge.h"

@interface JunkpileSyphonMetalWrapper : NSObject
@property (nonatomic, strong) id<MTLDevice> device;
@property (nonatomic, strong) id<MTLCommandQueue> commandQueue;
@property (nonatomic, strong) SyphonMetalServer *server;
@property (nonatomic, strong) id<MTLTexture> texture;
@property (nonatomic, assign) NSUInteger textureWidth;
@property (nonatomic, assign) NSUInteger textureHeight;
@end

@implementation JunkpileSyphonMetalWrapper
@end

static BOOL junkpile_prepare_texture(
    JunkpileSyphonMetalWrapper *wrapper,
    uint32_t width,
    uint32_t height
) {
    if (wrapper.texture &&
        wrapper.textureWidth == (NSUInteger)width &&
        wrapper.textureHeight == (NSUInteger)height) {
        return YES;
    }

    MTLTextureDescriptor *descriptor = [MTLTextureDescriptor
        texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
        width:(NSUInteger)width
        height:(NSUInteger)height
        mipmapped:NO];
    descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageRenderTarget;
    descriptor.storageMode = MTLStorageModeShared;

    id<MTLTexture> texture = [wrapper.device newTextureWithDescriptor:descriptor];
    if (!texture) {
        return NO;
    }

    wrapper.texture = texture;
    wrapper.textureWidth = (NSUInteger)width;
    wrapper.textureHeight = (NSUInteger)height;
    return YES;
}

void* junkpile_syphon_server_create(const char* name_utf8) {
    @autoreleasepool {
        NSString *name = name_utf8
            ? [NSString stringWithUTF8String:name_utf8]
            : @"Junkpile 37";
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        if (!device) {
            return NULL;
        }

        id<MTLCommandQueue> queue = [device newCommandQueue];
        if (!queue) {
            return NULL;
        }

        SyphonMetalServer *server = [[SyphonMetalServer alloc]
            initWithName:name
            device:device
            options:nil];
        if (!server) {
            return NULL;
        }

        JunkpileSyphonMetalWrapper *wrapper = [JunkpileSyphonMetalWrapper new];
        wrapper.device = device;
        wrapper.commandQueue = queue;
        wrapper.server = server;
        wrapper.texture = nil;
        wrapper.textureWidth = 0;
        wrapper.textureHeight = 0;
        return (__bridge_retained void*)wrapper;
    }
}

void junkpile_syphon_server_destroy(void* server_ptr) {
    @autoreleasepool {
        if (!server_ptr) {
            return;
        }
        JunkpileSyphonMetalWrapper *wrapper =
            (__bridge_transfer JunkpileSyphonMetalWrapper*)server_ptr;
        [wrapper.server stop];
        wrapper.texture = nil;
        wrapper.server = nil;
        wrapper.commandQueue = nil;
        wrapper.device = nil;
        (void)wrapper;
    }
}

int32_t junkpile_syphon_server_has_clients(void* server_ptr) {
    @autoreleasepool {
        if (!server_ptr) {
            return 0;
        }
        JunkpileSyphonMetalWrapper *wrapper =
            (__bridge JunkpileSyphonMetalWrapper*)server_ptr;
        return wrapper.server.hasClients ? 1 : 0;
    }
}

int32_t junkpile_syphon_server_publish_bgra(
    void* server_ptr,
    const uint8_t* bytes,
    uint32_t width,
    uint32_t height,
    uint32_t bytes_per_row
) {
    @autoreleasepool {
        if (!server_ptr || !bytes || width == 0 || height == 0) {
            return 0;
        }

        JunkpileSyphonMetalWrapper *wrapper =
            (__bridge JunkpileSyphonMetalWrapper*)server_ptr;
        if (!wrapper.server || !wrapper.device || !wrapper.commandQueue) {
            return 0;
        }
        if (!junkpile_prepare_texture(wrapper, width, height)) {
            return 0;
        }

        MTLRegion region = MTLRegionMake2D(0, 0, (NSUInteger)width, (NSUInteger)height);
        [wrapper.texture replaceRegion:region
                           mipmapLevel:0
                             withBytes:bytes
                           bytesPerRow:(NSUInteger)bytes_per_row];

        id<MTLCommandBuffer> commandBuffer = [wrapper.commandQueue commandBuffer];
        if (!commandBuffer) {
            return 0;
        }

        [wrapper.server publishFrameTexture:wrapper.texture
                            onCommandBuffer:commandBuffer
                                imageRegion:NSMakeRect(0.0, 0.0, width, height)
                                    flipped:NO];
        [commandBuffer commit];

        // The CPU upload texture is reused on the following frame. Waiting here
        // guarantees Syphon has finished copying it before that memory is changed.
        // This work happens on the bounded sender worker, never on the renderer.
        [commandBuffer waitUntilCompleted];
        return commandBuffer.status == MTLCommandBufferStatusCompleted ? 1 : 0;
    }
}
