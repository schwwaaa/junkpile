struct Uniforms {
    timing: vec4<f32>,
    resolution: vec4<f32>,
    params: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

const LIVE_EDIT_TINT: f32 = 0.0;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

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
    output.uv = position * 0.5 + vec2<f32>(0.5);
    return output;
}

fn rotate2(p: vec2<f32>, angle: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn palette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.50, 0.50, 0.50);
    let b = vec3<f32>(0.50, 0.50, 0.50);
    let c = vec3<f32>(1.00, 1.00, 1.00);
    let d = vec3<f32>(0.00, 0.10, 0.20);
    return a + b * cos(TAU * (c * t + d));
}

fn hash11(x: f32) -> f32 {
    return fract(sin(x * 127.1) * 43758.5453123);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = u.timing.x;
    let gain = u.params.x;
    let zoom = u.params.y;
    let spin_speed = u.params.z;
    let complexity = u.params.w;
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    var p = (input.uv - 0.5) * vec2<f32>(aspect, 1.0) * zoom * 2.0;
    p = rotate2(p, time * spin_speed);
    var wave = 0.0;
    var energy = 0.0;
    let emitter_count = clamp(complexity * 2.5, 3.0, 30.0);
    for (var i: i32 = 0; i < 30; i = i + 1) {
        if (f32(i) >= emitter_count) { break; }
        let fi = f32(i);
        let seed = hash11(fi + 1.0);
        let angle = TAU * seed + time * (0.04 + 0.015 * hash11(fi + 9.0));
        let radius = 0.35 + 1.05 * hash11(fi + 17.0);
        let emitter = vec2<f32>(cos(angle), sin(angle)) * radius;
        let distance_value = max(length(p - emitter), 0.015);
        let phase = distance_value * (18.0 + 2.2 * complexity) - time * (1.0 + seed);
        wave = wave + sin(phase) / sqrt(distance_value);
        energy = energy + 1.0 / (1.0 + 10.0 * distance_value * distance_value);
    }
    wave = wave / sqrt(emitter_count);
    let field = 0.5 + 0.5 * sin(wave * 2.2);
    var color = palette(field * 0.62 + energy * 0.025 + time * 0.006);
    color = color * (0.18 + gain * 1.5) * (0.35 + field * 0.85);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.22, 0.08, 0.01);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
