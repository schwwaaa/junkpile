struct Uniforms {
    resolution_time: vec4<f32>,
    controls0: vec4<f32>,
    controls1: vec4<f32>,
};

struct GesturePoint {
    position_velocity: vec4<f32>,
    pressure_age_tool_active: vec4<f32>,
};

struct GestureData {
    points: array<GesturePoint, 64>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> gesture: GestureData;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const TAU: f32 = 6.283185307179586;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    var output: VertexOutput;
    let position = positions[vertex_index];
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.uv = position * 0.5 + vec2<f32>(0.5);
    return output;
}

fn hsv2rgb(value: vec3<f32>) -> vec3<f32> {
    let p = abs(fract(value.xxx + vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return value.z * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), value.y);
}

fn hash21(point: vec2<f32>) -> f32 {
    return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let time = u.resolution_time.z;
    let point_count = u.resolution_time.w;
    let aspect = resolution.x / resolution.y;
    let radius_control = u.controls0.x;
    let force = u.controls0.y;
    let decay = u.controls0.z;
    let mode = u.controls0.w;
    let depth = u.controls1.x;
    let exposure = u.controls1.y;

    var p = input.uv * 2.0 - vec2<f32>(1.0);
    p.x *= aspect;
    var color = vec3<f32>(0.006, 0.008, 0.014);
    var displacement = vec2<f32>(0.0);
    var total_energy = 0.0;

    for (var i: u32 = 0u; i < 64u; i = i + 1u) {
        if (f32(i) >= point_count) { break; }
        let sample = gesture.points[i];
        var center = sample.position_velocity.xy * 2.0 - vec2<f32>(1.0);
        center.x *= aspect;
        let velocity = sample.position_velocity.zw;
        let pressure = sample.pressure_age_tool_active.x;
        let age = sample.pressure_age_tool_active.y;
        let tool = sample.pressure_age_tool_active.z;
        let active_state = sample.pressure_age_tool_active.w;
        let lifetime = pow(decay, age * 64.0);
        let delta = p - center;
        let distance_to_point = length(delta);
        let brush = radius_control * (0.35 + pressure * 1.1);
        let influence = exp(-distance_to_point * distance_to_point / max(brush * brush, 0.0001)) * lifetime;
        let tangent = vec2<f32>(-delta.y, delta.x) / max(distance_to_point, 0.001);
        let direction = normalize(delta + vec2<f32>(0.0001));
        let signed_force = select(1.0, -1.0, tool > 1.5 && tool < 2.5);
        let vortex_amount = select(0.0, 1.0, tool > 1.5 && tool < 2.5);
        displacement += (velocity * 0.010 + tangent * vortex_amount * 0.04 + direction * signed_force * 0.02) * influence * force;
        total_energy += influence * (0.35 + length(velocity) * 0.01 + active_state * 0.5);
        let hue = fract(0.56 + f32(i) * 0.018 + tool * 0.12 + time * 0.018);
        color += hsv2rgb(vec3<f32>(hue, 0.82, 1.0)) * influence * (0.18 + pressure * 0.9);
    }

    let warped = p + displacement;
    if (mode < 0.5) {
        let grid = pow(abs(sin(warped.x * 24.0) * sin(warped.y * 24.0)), 7.0);
        color += vec3<f32>(0.15, 0.5, 1.0) * grid * total_energy;
    } else if (mode < 1.5) {
        let fluid = sin(warped.x * 8.0 + sin(warped.y * 11.0 + time)) * cos(warped.y * 9.0 - time * 0.7);
        color += hsv2rgb(vec3<f32>(fract(0.62 + fluid * 0.08), 0.88, 0.55 + 0.45 * fluid)) * total_energy;
    } else if (mode < 2.5) {
        let z = sin(length(warped) * 18.0 - time * 2.0 + total_energy * 5.0) * depth;
        let rings = 0.025 / max(abs(fract(length(warped) * 7.0 + z) - 0.5), 0.02);
        color += hsv2rgb(vec3<f32>(fract(0.78 + z * 0.1), 0.74, rings * 0.18)) * (0.4 + total_energy);
    } else {
        var ray = vec3<f32>(warped, -1.8);
        let sphere = abs(length(ray + vec3<f32>(displacement * 2.5, total_energy * depth)) - (0.55 + total_energy * 0.18));
        let surface = 0.018 / max(sphere, 0.006);
        color += hsv2rgb(vec3<f32>(fract(0.05 + total_energy * 0.13), 0.84, surface * 0.08));
    }

    let grain = (hash21(floor(input.uv * resolution)) - 0.5) / 255.0;
    color = vec3<f32>(1.0) - exp(-max(color, vec3<f32>(0.0)) * exposure);
    color += grain;
    return vec4<f32>(color, 1.0);
}
