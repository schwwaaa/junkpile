struct Uniforms {
    resolution_time: vec4<f32>,
    params0: vec4<f32>,
    params1: vec4<f32>,
    midi: vec4<f32>,
};

struct MidiData {
    notes: array<f32, 128>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var<storage, read> midi_data: MidiData;

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
    let c = cos(angle);
    let s = sin(angle);
    return vec2<f32>(c * point.x - s * point.y, s * point.x + c * point.y);
}

fn hash21(point: vec2<f32>) -> f32 {
    let projected = dot(point, vec2<f32>(127.1, 311.7));
    return fract(sin(projected) * 43758.5453123);
}

fn hsv2rgb(value: vec3<f32>) -> vec3<f32> {
    let p = abs(fract(value.xxx + vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return value.z * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), value.y);
}

fn sample_note(index: i32) -> f32 {
    let wrapped = ((index % 128) + 128) % 128;
    return midi_data.notes[u32(wrapped)];
}

fn note_band(angle: f32, radius: f32) -> vec2<f32> {
    let normalized_angle = fract(angle / TAU + 0.5);
    let continuous_note = normalized_angle * 128.0;
    let center_index = i32(floor(continuous_note));
    let fraction = fract(continuous_note);
    let left = sample_note(center_index - 1);
    let center = sample_note(center_index);
    let right = sample_note(center_index + 1);
    let interpolated = mix(center, right, fraction) + left * (1.0 - fraction) * 0.28;
    let target_radius = 0.18 + fract(continuous_note / 12.0) * 0.62;
    let radial_band = exp(-abs(radius - target_radius) * 38.0);
    return vec2<f32>(interpolated, radial_band);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let time = u.resolution_time.z;
    let aspect = resolution.x / resolution.y;

    let hue = u.params0.x;
    let zoom = mix(0.55, 2.8, u.params0.y);
    let rotation = (u.params0.z * 2.0 - 1.0) * PI + u.midi.x * 0.42;
    let field_strength = mix(0.15, 3.4, u.params0.w);
    let turbulence = mix(0.0, 3.2, u.params1.x);
    let exposure = mix(0.45, 3.5, u.params1.z);

    var point = input.uv * 2.0 - vec2<f32>(1.0);
    point.x *= aspect;
    point = rotate2(point / zoom, rotation);

    let radius = length(point);
    let angle = atan2(point.y, point.x);
    let band = note_band(angle + time * 0.025 * field_strength, radius);
    let note_value = band.x;
    let note_ring = band.y * note_value;

    let last_note_angle = (u.midi.z - 0.5) * TAU;
    let note_direction = vec2<f32>(cos(last_note_angle), sin(last_note_angle));
    let note_beam = pow(max(0.0, dot(normalize(point + vec2<f32>(0.0001)), note_direction)), 48.0);

    let warp_a = sin(point.y * (7.0 + turbulence * 4.0) + time * (0.3 + field_strength * 0.22));
    let warp_b = cos(point.x * (9.0 + field_strength * 3.0) - time * (0.22 + turbulence * 0.18));
    let warped = point + vec2<f32>(warp_a, warp_b) * (0.04 + turbulence * 0.035);

    let grid_x = abs(sin(warped.x * (18.0 + field_strength * 9.0)));
    let grid_y = abs(sin(warped.y * (18.0 + turbulence * 8.0)));
    let grid = pow(max(grid_x, grid_y), 18.0) * 0.22;

    let spokes = pow(abs(cos(angle * (6.0 + floor(field_strength * 4.0)) + time * 0.15)), 24.0);
    let tunnel = 0.028 / max(abs(fract(radius * (7.0 + field_strength * 4.0) - time * 0.08) - 0.5), 0.025);
    let pressure_glow = u.midi.y * exp(-radius * 2.6);
    let pulse_glow = u.midi.w * exp(-radius * 5.2);

    let stable_grain = hash21(floor(input.position.xy)) - 0.5;
    let energy = note_ring * 3.2
        + note_beam * note_value * 1.8
        + grid
        + spokes * (0.06 + note_value * 0.4)
        + tunnel * (0.02 + u.params1.y * 0.04)
        + pressure_glow * 0.85
        + pulse_glow * 1.6;

    let base_hue = fract(hue + angle / TAU * 0.15 + radius * 0.08 + note_value * 0.2);
    let saturation = 0.68 + note_value * 0.28;
    var color = hsv2rgb(vec3<f32>(base_hue, saturation, 0.12 + energy));
    color += hsv2rgb(vec3<f32>(fract(base_hue + 0.22), 0.82, 1.0)) * note_ring * 1.25;
    color += vec3<f32>(stable_grain * 0.012);
    color *= exposure;
    color = color / (vec3<f32>(1.0) + color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.82));

    let vignette = 1.0 - smoothstep(0.18, 1.45, radius);
    return vec4<f32>(color * (0.42 + vignette * 0.58), 1.0);
}
