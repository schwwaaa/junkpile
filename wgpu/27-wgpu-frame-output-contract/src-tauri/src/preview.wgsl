@group(0) @binding(0)
var authoritative_texture: texture_2d<f32>;
@group(0) @binding(1)
var recording_texture: texture_2d<f32>;
@group(0) @binding(2)
var streaming_texture: texture_2d<f32>;
@group(0) @binding(3)
var frame_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var output: VertexOutput;
    let position = positions[vertex_index];
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.uv = position * 0.5 + vec2<f32>(0.5, 0.5);
    return output;
}

fn border(uv: vec2<f32>, thickness: f32) -> f32 {
    let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    return 1.0 - smoothstep(0.0, thickness, edge);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.uv;
    let divider = 0.72;
    var color: vec3<f32>;

    if (uv.x < divider) {
        let local = vec2<f32>(uv.x / divider, uv.y);
        color = textureSample(authoritative_texture, frame_sampler, local).rgb;
        color = mix(color, vec3<f32>(0.15, 0.8, 1.0), border(local, 0.008) * 0.72);
    } else if (uv.y < 0.5) {
        let local = vec2<f32>((uv.x - divider) / (1.0 - divider), uv.y * 2.0);
        color = textureSample(recording_texture, frame_sampler, local).rgb;
        color = mix(color, vec3<f32>(0.82, 0.43, 1.0), border(local, 0.018) * 0.78);
    } else {
        let local = vec2<f32>((uv.x - divider) / (1.0 - divider), (uv.y - 0.5) * 2.0);
        color = textureSample(streaming_texture, frame_sampler, local).rgb;
        color = mix(color, vec3<f32>(0.3, 1.0, 0.62), border(local, 0.018) * 0.78);
    }

    let split_line = 1.0 - smoothstep(0.0, 0.004, abs(uv.x - divider));
    color = mix(color, vec3<f32>(0.95), split_line * 0.55);
    return vec4<f32>(color, 1.0);
}
