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

fn grid_line(value: f32, divisions: f32) -> f32 {
    let cell = abs(fract(value * divisions) - 0.5);
    return 1.0 - smoothstep(0.455, 0.49, cell);
}

fn box_mask(uv: vec2<f32>, minimum: vec2<f32>, maximum: vec2<f32>) -> f32 {
    let inside_min = step(minimum, uv);
    let inside_max = step(uv, maximum);
    return inside_min.x * inside_min.y * inside_max.x * inside_max.y;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = u.timing.x;
    let uv = input.uv;
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    let p = (uv - 0.5) * vec2<f32>(aspect, 1.0);

    let wave_a = 0.5 + 0.5 * sin(p.x * 9.0 + time * 1.25);
    let wave_b = 0.5 + 0.5 * cos(p.y * 12.0 - time * 0.9);
    let orbit = 0.5 + 0.5 * sin(atan2(p.y, p.x) * 6.0 - time * 1.5 + length(p) * 18.0);
    var color = vec3<f32>(
        0.05 + wave_a * 0.35,
        0.07 + wave_b * 0.38,
        0.18 + orbit * 0.58
    );

    let grid = max(grid_line(uv.x, 16.0), grid_line(uv.y, 9.0));
    color += grid * vec3<f32>(0.10, 0.16, 0.22);

    let circle_distance = abs(length(p) - 0.245);
    let circle = 1.0 - smoothstep(0.006, 0.013, circle_distance);
    color = mix(color, vec3<f32>(0.96, 0.96, 0.96), circle * 0.88);

    let cross_x = 1.0 - smoothstep(0.002, 0.006, abs(uv.x - 0.5));
    let cross_y = 1.0 - smoothstep(0.002, 0.006, abs(uv.y - 0.5));
    color = mix(color, vec3<f32>(0.95, 0.78, 0.18), max(cross_x, cross_y) * 0.78);

    let moving = vec2<f32>(
        0.5 + 0.31 * sin(time * 0.73),
        0.5 + 0.28 * cos(time * 0.91)
    );
    let pulse = 1.0 - smoothstep(0.018, 0.065, distance(uv, moving));
    color += pulse * vec3<f32>(0.55, 0.88, 1.0);

    let top_left = box_mask(uv, vec2<f32>(0.025, 0.025), vec2<f32>(0.115, 0.115));
    let top_right = box_mask(uv, vec2<f32>(0.885, 0.025), vec2<f32>(0.975, 0.115));
    let bottom_left = box_mask(uv, vec2<f32>(0.025, 0.885), vec2<f32>(0.115, 0.975));
    let bottom_right = box_mask(uv, vec2<f32>(0.885, 0.885), vec2<f32>(0.975, 0.975));
    color = mix(color, vec3<f32>(0.95, 0.15, 0.16), top_left);
    color = mix(color, vec3<f32>(0.18, 0.92, 0.36), top_right);
    color = mix(color, vec3<f32>(0.20, 0.45, 1.0), bottom_left);
    color = mix(color, vec3<f32>(0.98, 0.78, 0.10), bottom_right);

    let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    let border = 1.0 - smoothstep(0.008, 0.014, edge);
    color = mix(color, vec3<f32>(1.0), border);

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
