struct Uniforms {
    timing: vec4<f32>,
    resolution: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

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

fn hash21(p: vec2<f32>) -> f32 {
    let q = fract(p * vec2<f32>(123.34, 456.21));
    return fract((q.x + q.y) * (q.x + 45.32));
}

fn grid_line(value: f32, divisions: f32) -> f32 {
    let cell = abs(fract(value * divisions) - 0.5);
    return 1.0 - smoothstep(0.46, 0.49, cell);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = u.timing.x;
    let frame = u.timing.y;
    let uv = input.uv;
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    let p = (uv - 0.5) * vec2<f32>(aspect, 1.0);

    let wave_a = sin(p.x * 8.0 + time * 1.4) * 0.5 + 0.5;
    let wave_b = cos(p.y * 11.0 - time * 1.1) * 0.5 + 0.5;
    let radial = 1.0 - smoothstep(0.05, 0.9, length(p));
    let orbit = 0.5 + 0.5 * sin(atan2(p.y, p.x) * 5.0 - time * 1.7 + length(p) * 17.0);

    var color = vec3<f32>(
        0.05 + 0.45 * wave_a,
        0.08 + 0.42 * wave_b,
        0.16 + 0.68 * orbit
    );
    color += vec3<f32>(0.25, 0.08, 0.38) * radial;

    let gx = grid_line(uv.x, 16.0);
    let gy = grid_line(uv.y, 9.0);
    color += vec3<f32>(0.08, 0.15, 0.22) * max(gx, gy);

    let pulse_center = vec2<f32>(
        0.5 + 0.28 * sin(time * 0.72),
        0.5 + 0.25 * cos(time * 0.91)
    );
    let pulse = 1.0 - smoothstep(0.015, 0.12, distance(uv, pulse_center));
    color += pulse * vec3<f32>(0.75, 0.92, 1.0);

    let grain = hash21(floor(uv * u.resolution.xy) + vec2<f32>(frame, frame)) - 0.5;
    color += vec3<f32>(grain * 0.035);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
