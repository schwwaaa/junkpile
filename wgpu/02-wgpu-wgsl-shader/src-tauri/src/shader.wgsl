struct Uniforms {
    timing: vec4<f32>,
    image: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0,-3.0), vec2<f32>(3.0,1.0), vec2<f32>(-1.0,1.0));
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn hash21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p); let f = fract(p); let s = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0,0.0)), s.x), mix(hash21(i + vec2<f32>(0.0,1.0)), hash21(i + vec2<f32>(1.0,1.0)), s.x), s.y);
}
fn fbm(input: vec2<f32>) -> f32 {
    var p = input; var value = 0.0; var amplitude = 0.5;
    for (var i = 0; i < 5; i = i + 1) { value += amplitude * noise(p); p = mat2x2<f32>(1.6,1.2,-1.2,1.6) * p; amplitude *= 0.5; }
    return value;
}
fn palette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.48,0.50,0.55); let b = vec3<f32>(0.45,0.35,0.48);
    let c = vec3<f32>(1.0,1.0,1.0); let d = vec3<f32>(0.04,0.18,0.42);
    return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.image.xy, vec2<f32>(1.0));
    var uv = (2.0 * p.xy - resolution) / min(resolution.x, resolution.y);
    let t = u.timing.x * 0.12;
    let q = vec2<f32>(fbm(uv * 1.7 + t), fbm(uv * 1.7 + vec2<f32>(4.2,1.3) - t * 0.8));
    let r = vec2<f32>(fbm(uv * 2.0 + q * 2.2 + vec2<f32>(1.7,9.2) + t), fbm(uv * 2.0 + q * 2.0 + vec2<f32>(8.3,2.8) - t));
    let f = fbm(uv * 1.35 + r * 2.7);
    var color = palette(f + length(q) * 0.22 + t * 0.08);
    color *= 0.52 + 0.9 * f;
    color += 0.12 / (0.18 + length(uv));
    return vec4<f32>(pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.86)), 1.0);
}
