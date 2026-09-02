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
    var c = (input.uv - 0.5) * vec2<f32>(aspect, 1.0) * (2.8 / max(zoom, 0.15));
    c = rotate2(c, time * spin_speed);
    c = c + vec2<f32>(-0.57 + 0.08 * sin(time * 0.11), 0.0);
    var z = vec2<f32>(0.0);
    var escaped = 0.0;
    var iteration = 0.0;
    let max_iterations = clamp(complexity * 9.0, 9.0, 108.0);
    for (var i: i32 = 0; i < 108; i = i + 1) {
        if (f32(i) >= max_iterations) { break; }
        z = vec2<f32>(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        iteration = f32(i);
        if (dot(z, z) > 64.0) {
            escaped = 1.0;
            break;
        }
    }
    let smooth_iteration = iteration - log2(max(log2(max(length(z), 1.0001)), 0.0001));
    let normalized = smooth_iteration / max_iterations;
    var color = palette(normalized * 1.8 + time * 0.008);
    color = color * escaped * (0.24 + gain * 1.65);
    color = color + (1.0 - escaped) * vec3<f32>(0.005, 0.008, 0.02);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.20, 0.08, 0.02);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
