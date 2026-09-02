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
    var p = (input.uv - 0.5) * vec2<f32>(aspect, 1.0) * zoom * 2.8;
    p = rotate2(p, time * spin_speed);
    var q = p;
    var intensity = 0.0;
    var previous = 0.0;
    for (var i: i32 = 0; i < 18; i = i + 1) {
        if (f32(i) >= complexity + 4.0) { break; }
        let fi = f32(i) + 1.0;
        q = vec2<f32>(
            q.x + sin(q.y * (1.3 + fi * 0.09) + time * 0.31) / fi,
            q.y + cos(q.x * (1.5 + fi * 0.08) - time * 0.27) / fi
        );
        let wave = abs(sin(q.x * fi) + cos(q.y * (fi + 0.7)));
        intensity = intensity + 0.018 / max(abs(wave - previous), 0.015);
        previous = wave;
    }
    intensity = pow(clamp(intensity * 0.16, 0.0, 1.0), 1.35);
    var color = vec3<f32>(0.03, 0.18, 0.33) + palette(intensity * 0.65 + time * 0.006) * intensity;
    color = color * (0.25 + gain * 1.55);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.18, 0.03, 0.22);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
