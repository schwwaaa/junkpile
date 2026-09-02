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

fn hash21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

fn noise2(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let s = f * f * (vec2<f32>(3.0) - 2.0 * f);
    return mix(
        mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), s.x),
        mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), s.x),
        s.y
    );
}

fn fbm(p0: vec2<f32>, octaves: f32) -> f32 {
    var p = p0;
    var value = 0.0;
    var amplitude = 0.52;
    for (var i: i32 = 0; i < 12; i = i + 1) {
        if (f32(i) >= octaves) { break; }
        value = value + amplitude * noise2(p);
        p = rotate2(p * 2.03 + vec2<f32>(17.1, 9.2), 0.47);
        amplitude = amplitude * 0.51;
    }
    return value;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = u.timing.x;
    let gain = u.params.x;
    let zoom = u.params.y;
    let spin_speed = u.params.z;
    let complexity = u.params.w;
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    var p = (input.uv - 0.5) * vec2<f32>(aspect, 1.0) * zoom * 2.2;
    p = rotate2(p, time * spin_speed);
    let q = vec2<f32>(
        fbm(p + vec2<f32>(0.0, time * 0.08), complexity),
        fbm(p + vec2<f32>(5.2, -time * 0.07), complexity)
    );
    let r = vec2<f32>(
        fbm(p + 3.8 * q + vec2<f32>(1.7, 9.2), complexity),
        fbm(p + 3.1 * q + vec2<f32>(8.3, 2.8), complexity)
    );
    let density = fbm(p + 4.5 * r, complexity);
    var color = palette(density * 0.72 + length(q) * 0.18 + time * 0.01);
    color = color * (0.15 + gain * 1.65) * pow(max(density, 0.0), 1.35);
    color = color + vec3<f32>(0.03, 0.08, 0.22) * (1.0 - density);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.24, 0.02, 0.08);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
