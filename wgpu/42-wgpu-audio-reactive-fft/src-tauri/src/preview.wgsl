@group(0) @binding(0)
var source_texture: texture_2d<f32>;
@group(0) @binding(1)
var source_sampler: sampler;

struct PreviewUniforms {
    dimensions: vec4<f32>,
    mode: vec4<u32>,
};

@group(0) @binding(2)
var<uniform> u: PreviewUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) fragment_position: vec4<f32>) -> @location(0) vec4<f32> {
    let destination = max(u.dimensions.xy, vec2<f32>(1.0));
    let source = max(u.dimensions.zw, vec2<f32>(1.0));
    let pixel = fragment_position.xy;
    let mode = u.mode.x;

    var uv = pixel / destination;

    if (mode != 2u) {
        let fit_scale = min(destination.x / source.x, destination.y / source.y);
        let fill_scale = max(destination.x / source.x, destination.y / source.y);
        var scale = fit_scale;
        if (mode == 1u) {
            scale = fill_scale;
        }
        if (mode == 3u) {
            scale = 1.0;
        }

        let image_size = source * scale;
        let offset = (destination - image_size) * 0.5;
        let q = (pixel - offset) / image_size;
        if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
            return vec4<f32>(0.0, 0.0, 0.0, 1.0);
        }
        uv = q;
    }

    return textureSample(source_texture, source_sampler, uv);
}
