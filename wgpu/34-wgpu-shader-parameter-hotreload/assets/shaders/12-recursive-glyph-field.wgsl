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
    var p = (input.uv - 0.5) * vec2<f32>(aspect, 1.0) * zoom * 1.35;
    p = rotate2(p, time * spin_speed);
    var q = p;
    var glyph = 0.0;
    var scale = 1.0;
    for (var i: i32 = 0; i < 16; i = i + 1) {
        if (f32(i) >= complexity + 2.0) { break; }
        q = abs(q) - vec2<f32>(0.42, 0.27);
        if (q.x < q.y) {
            q = q.yx;
        }
        q = rotate2(q, 0.72 + 0.05 * sin(time * 0.2 + f32(i)));
        q = q * 1.52 - vec2<f32>(0.31, 0.19);
        let line = exp(-55.0 * abs(abs(q.x) - 0.08)) + exp(-55.0 * abs(abs(q.y) - 0.08));
        glyph = glyph + line / scale;
        scale = scale * 1.34;
    }
    let radial = 0.5 + 0.5 * sin(length(p) * (18.0 + complexity) - time * 1.2);
    var color = palette(glyph * 0.24 + radial * 0.22 + time * 0.005);
    color = color * (0.18 + gain * 1.55) * (0.2 + glyph * 0.9 + radial * 0.25);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.02, 0.14, 0.28);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
