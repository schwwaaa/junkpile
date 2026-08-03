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

fn sd_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn scene(p0: vec3<f32>, time: f32, complexity: f32) -> f32 {
    var p = p0;
    let cell = 1.2 + 0.06 * complexity;
    p = (fract(p / cell + vec3<f32>(0.5)) - vec3<f32>(0.5)) * cell;
    let box_size = vec3<f32>(0.22 + 0.025 * sin(time), 0.22, 0.22);
    let box_distance = sd_box(p, box_size);
    let sphere_distance = length(p) - (0.31 + 0.04 * cos(time * 0.7));
    return max(box_distance, -sphere_distance);
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
    let roll = time * spin_speed;
    let ray_origin = vec3<f32>(0.0, 0.0, -3.2 - zoom * 0.35);
    let base_ray_direction = normalize(vec3<f32>(uv, 1.35));
    let rotated_ray_xy = rotate2(base_ray_direction.xy, roll);
    let ray_direction = vec3<f32>(rotated_ray_xy, base_ray_direction.z);
    var travel = 0.0;
    var glow = 0.0;
    var hit = 0.0;
    let max_steps = clamp(complexity * 8.0, 8.0, 96.0);
    for (var i: i32 = 0; i < 96; i = i + 1) {
        if (f32(i) >= max_steps) { break; }
        let base_p = ray_origin + ray_direction * travel;
        let rotated_p_xy = rotate2(base_p.xy, roll * 0.35);
        let p = vec3<f32>(rotated_p_xy, base_p.z + time * 0.48);
        let distance_value = scene(p, time, complexity);
        glow = glow + exp(-18.0 * abs(distance_value)) * 0.018;
        if (distance_value < 0.0015) {
            hit = 1.0;
            break;
        }
        travel = travel + max(distance_value * 0.62, 0.006);
        if (travel > 12.0) { break; }
    }
    let fog = exp(-0.07 * travel * travel);
    var color = palette(travel * 0.055 + glow * 0.35 + time * 0.012);
    color = color * (glow * (1.4 + gain * 2.4) + hit * 0.75) * fog;
    color = color + vec3<f32>(0.01, 0.02, 0.05) * (1.0 - fog);
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.02, 0.22, 0.12);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
