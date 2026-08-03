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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = u.timing.x;
    let gain = u.params.x;
    let zoom = u.params.y;
    let spin_speed = u.params.z;
    let complexity = u.params.w;
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    var p = (input.uv - 0.5) * vec2<f32>(aspect, 1.0) * zoom;
    p = rotate2(p, time * spin_speed);
    let sectors = 3.0 + floor(complexity * 0.85);
    let radius = length(p);
    var angle = atan2(p.y, p.x);
    angle = abs(fract(angle / TAU * sectors + 0.5) - 0.5) * TAU / sectors;
    var q = vec2<f32>(cos(angle), sin(angle)) * radius;
    var energy = 0.0;
    var weight = 1.0;
    for (var i: i32 = 0; i < 12; i = i + 1) {
        if (f32(i) >= complexity) { break; }
        q = abs(q) / max(dot(q, q), 0.08) - vec2<f32>(0.72, 0.58);
        energy = energy + weight * exp(-7.0 * abs(length(q) - 0.55));
        weight = weight * 0.72;
    }
    let bands = 0.5 + 0.5 * sin(radius * (26.0 + complexity * 2.0) - time * 1.7);
    var color = palette(energy * 0.45 + bands * 0.18 + radius * 0.12);
    color = color * (0.20 + gain * 1.45) * (0.35 + energy);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.28, 0.02, 0.16);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
