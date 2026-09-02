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
    var q = p;
    var orbit = 10.0;
    for (var i: i32 = 0; i < 14; i = i + 1) {
        if (f32(i) >= complexity + 2.0) { break; }
        q = abs(q);
        if (q.x < q.y) {
            q = q.yx;
        }
        q = q / max(dot(q, q), 0.10) - vec2<f32>(0.72, 0.28);
        orbit = min(orbit, abs(length(q) - 0.75));
    }
    let log_radius = log(max(length(q), 0.0005));
    let angle = atan2(q.y, q.x);
    let grid_a = smoothstep(0.09, 0.0, abs(fract(log_radius * (2.0 + complexity * 0.15)) - 0.5));
    let grid_b = smoothstep(0.08, 0.0, abs(fract(angle / TAU * (7.0 + complexity)) - 0.5));
    let glow = exp(-18.0 * orbit);
    var color = palette(angle / TAU + log_radius * 0.08 + time * 0.008);
    color = color * (0.18 + gain * 1.55) * (0.18 + grid_a + grid_b + glow);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.06, 0.22, 0.05);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
