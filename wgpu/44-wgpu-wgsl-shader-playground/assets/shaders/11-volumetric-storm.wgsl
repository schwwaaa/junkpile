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

fn hash31(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453123);
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let s = f * f * (vec3<f32>(3.0) - 2.0 * f);
    let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
    let x00 = mix(n000, n100, s.x);
    let x10 = mix(n010, n110, s.x);
    let x01 = mix(n001, n101, s.x);
    let x11 = mix(n011, n111, s.x);
    return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}

fn density(p0: vec3<f32>, complexity: f32) -> f32 {
    var p = p0;
    var value = 0.0;
    var amplitude = 0.55;
    for (var i: i32 = 0; i < 8; i = i + 1) {
        if (f32(i) >= complexity * 0.65) { break; }
        value = value + amplitude * noise3(p);
        p = p * 2.03 + vec3<f32>(9.2, 3.1, 7.4);
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
    let uv = (input.uv - 0.5) * vec2<f32>(aspect, 1.0);
    let base_ray_direction = normalize(vec3<f32>(uv / max(zoom, 0.25), 1.25));
    let rotated_ray_xy = rotate2(base_ray_direction.xy, time * spin_speed);
    let ray_direction = vec3<f32>(rotated_ray_xy, base_ray_direction.z);
    var color = vec3<f32>(0.0);
    var transmittance = 1.0;
    let sample_count = clamp(complexity * 4.0, 8.0, 48.0);
    for (var i: i32 = 0; i < 48; i = i + 1) {
        if (f32(i) >= sample_count) { break; }
        let t = 0.08 + f32(i) * (5.8 / sample_count);
        let base_p = ray_direction * t + vec3<f32>(0.0, 0.0, time * 0.18);
        let rotated_p_xy = rotate2(base_p.xy, time * spin_speed * 0.42);
        let p = vec3<f32>(rotated_p_xy, base_p.z);
        let d = smoothstep(0.42, 0.82, density(p * 1.35, complexity));
        let alpha = d * 0.095 * transmittance;
        color = color + palette(d * 0.52 + t * 0.055 + time * 0.004) * alpha;
        transmittance = transmittance * (1.0 - alpha);
        if (transmittance < 0.02) { break; }
    }
    color = color * (0.25 + gain * 1.9);
    color = color + vec3<f32>(0.005, 0.008, 0.025) * transmittance;
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.20, 0.01, 0.12);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
