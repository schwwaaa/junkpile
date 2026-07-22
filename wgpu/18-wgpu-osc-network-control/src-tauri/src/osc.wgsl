struct Uniforms {
    resolution_time: vec4<f32>,
    params0: vec4<f32>,
    params1: vec4<f32>,
    osc: vec4<f32>,
};

struct OscData {
    signals: array<f32, 32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var<storage, read> osc_data: OscData;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    var output: VertexOutput;
    let position = positions[vertex_index];
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.uv = position * 0.5 + vec2<f32>(0.5);
    return output;
}

fn rotate2(point: vec2<f32>, angle: f32) -> vec2<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec2<f32>(
        cosine * point.x - sine * point.y,
        sine * point.x + cosine * point.y,
    );
}

fn hash21(point: vec2<f32>) -> f32 {
    return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

fn hsv2rgb(value: vec3<f32>) -> vec3<f32> {
    let p = abs(fract(value.xxx + vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return value.z * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), value.y);
}

fn sample_signal(index: i32) -> f32 {
    let wrapped = ((index % 32) + 32) % 32;
    return osc_data.signals[u32(wrapped)];
}

fn address_field(angle: f32, radius: f32) -> vec3<f32> {
    let normalized_angle = fract(angle / TAU + 0.5);
    let continuous_index = normalized_angle * 32.0;
    let center_index = i32(floor(continuous_index));
    let fraction = fract(continuous_index);
    let previous = sample_signal(center_index - 1);
    let center = sample_signal(center_index);
    let next = sample_signal(center_index + 1);
    let interpolated = mix(center, next, fraction) + previous * (1.0 - fraction) * 0.24;
    let lane = f32(center_index % 8);
    let target_radius = 0.20 + lane / 7.0 * 0.72;
    let radial = exp(-abs(radius - target_radius) * 42.0);
    return vec3<f32>(interpolated, radial, continuous_index / 32.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let time = u.resolution_time.z;
    let aspect = resolution.x / resolution.y;

    let hue = u.params0.x;
    let zoom = mix(0.55, 2.8, u.params0.y);
    let rotation = (u.params0.z * 2.0 - 1.0) * PI;
    let field_strength = mix(0.15, 3.4, u.params0.w);
    let turbulence = mix(0.0, 3.2, u.params1.x);
    let trail = u.params1.y;
    let exposure = mix(0.45, 3.5, u.params1.z);

    var point = input.uv * 2.0 - vec2<f32>(1.0);
    point.x *= aspect;
    point = rotate2(point / zoom, rotation + time * 0.025 * field_strength);

    let radius = length(point);
    let angle = atan2(point.y, point.x);
    let field = address_field(angle + time * 0.08, radius);
    let signal_value = field.x;
    let signal_ring = field.y * signal_value;

    let last_address_angle = (u.osc.y - 0.5) * TAU;
    let last_address_direction = vec2<f32>(cos(last_address_angle), sin(last_address_angle));
    let direction = normalize(point + vec2<f32>(0.0001));
    let address_beam = pow(max(0.0, dot(direction, last_address_direction)), 56.0);

    let warp_x = sin(point.y * (8.0 + turbulence * 4.0) + time * (0.26 + field_strength * 0.18));
    let warp_y = cos(point.x * (10.0 + field_strength * 3.0) - time * (0.20 + turbulence * 0.15));
    let warped = point + vec2<f32>(warp_x, warp_y) * (0.035 + turbulence * 0.035);

    let lattice_x = abs(sin(warped.x * (17.0 + field_strength * 8.0)));
    let lattice_y = abs(sin(warped.y * (17.0 + turbulence * 8.0)));
    let lattice = pow(max(lattice_x, lattice_y), 20.0) * (0.08 + u.osc.z * 0.30);

    let packet_rings = 0.018 / max(abs(fract(radius * (7.0 + field_strength * 5.0) - time * 0.15) - 0.5), 0.022);
    let bundle_spokes = pow(abs(cos(angle * (5.0 + floor(field_strength * 5.0)) + time * 0.22)), 30.0);
    let normalized_last_value = abs(u.osc.x) / (1.0 + abs(u.osc.x));
    let last_value_glow = normalized_last_value * exp(-radius * 2.8);
    let pulse_glow = u.osc.w * exp(-radius * 5.4);

    let stable_grain = hash21(floor(input.position.xy)) - 0.5;
    let energy = signal_ring * 3.4
        + address_beam * (0.25 + signal_value * 2.2)
        + lattice
        + packet_rings * (0.018 + trail * 0.05)
        + bundle_spokes * (0.04 + signal_value * 0.44)
        + last_value_glow * 0.65
        + pulse_glow * 1.7;

    let base_hue = fract(hue + angle / TAU * 0.18 + radius * 0.09 + field.z * 0.24);
    var color = hsv2rgb(vec3<f32>(base_hue, 0.72 + signal_value * 0.25, 0.10 + energy));
    color += hsv2rgb(vec3<f32>(fract(base_hue + 0.28), 0.86, 1.0)) * signal_ring * 1.30;
    color += vec3<f32>(stable_grain * 0.011);
    color *= exposure;
    color = color / (vec3<f32>(1.0) + color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.82));

    let vignette = 1.0 - smoothstep(0.20, 1.45, radius);
    return vec4<f32>(color * (0.40 + vignette * 0.60), 1.0);
}
