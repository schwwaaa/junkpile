struct Uniforms {
    resolution_time: vec4<f32>,
    levels: vec4<f32>,
    bands: vec4<f32>,
    visual: vec4<f32>,
    transform: vec4<f32>,
};

struct AudioData {
    spectrum: array<f32, 256>,
    waveform: array<f32, 512>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var<storage, read> audio: AudioData;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    var output: VertexOutput;
    output.clip_position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    return output;
}

fn hsv_to_rgb(hsv: vec3<f32>) -> vec3<f32> {
    let hue = fract(hsv.x);
    let p = abs(fract(hue + vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return hsv.z * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), hsv.y);
}

fn rotate2(value: vec2<f32>, angle: f32) -> vec2<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec2<f32>(cosine * value.x - sine * value.y, sine * value.x + cosine * value.y);
}

fn spectrum_value(normalized_index: f32) -> f32 {
    let index = u32(clamp(floor(normalized_index * 255.0), 0.0, 255.0));
    return clamp(audio.spectrum[index] * u.visual.x, 0.0, 1.6);
}

fn waveform_value(normalized_index: f32) -> f32 {
    let index = u32(clamp(floor(normalized_index * 511.0), 0.0, 511.0));
    return clamp(audio.waveform[index] * u.visual.y, -1.5, 1.5);
}

fn spectrum_bars(uv: vec2<f32>) -> vec3<f32> {
    let bin_position = clamp(uv.x, 0.0, 0.9999);
    let value = spectrum_value(bin_position);
    let cell = fract(bin_position * 256.0);
    let gap = smoothstep(0.02, 0.12, cell) * (1.0 - smoothstep(0.88, 0.98, cell));
    let bar = 1.0 - smoothstep(value - 0.01, value + 0.015, 1.0 - uv.y);
    let gradient = hsv_to_rgb(vec3<f32>(u.transform.x + bin_position * 0.32 + u.levels.w * 0.18, 0.82, 1.0));
    let waveform_y = 0.53 + waveform_value(bin_position) * 0.19;
    let pixel = 1.0 / max(u.resolution_time.y, 1.0);
    let wave = 1.0 - smoothstep(pixel * u.transform.y, pixel * (u.transform.y + 2.0), abs(uv.y - waveform_y));
    let wave_color = hsv_to_rgb(vec3<f32>(u.transform.x + 0.48, 0.55, 1.0));
    return gradient * bar * gap * (0.35 + value * 1.4) + wave_color * wave * (0.4 + u.levels.y);
}

fn radial_spectrum(uv: vec2<f32>) -> vec3<f32> {
    var centered = (uv - 0.5) * vec2<f32>(u.resolution_time.x / max(u.resolution_time.y, 1.0), 1.0);
    centered = rotate2(centered / max(u.transform.z, 0.01), u.transform.w);
    let radius = length(centered);
    let angle = fract(atan2(centered.y, centered.x) / 6.2831853 + 0.5);
    let value = spectrum_value(angle);
    let target_radius = 0.20 + value * 0.34;
    let thickness = (0.004 + u.transform.y * 0.0015) / max(u.transform.z, 0.2);
    let ring = 1.0 - smoothstep(thickness, thickness * 2.5, abs(radius - target_radius));
    let inner = 1.0 - smoothstep(0.0, 0.22 + u.bands.x * 0.10, radius);
    let color = hsv_to_rgb(vec3<f32>(u.transform.x + angle * 0.35 + u.levels.w * 0.2, 0.85, 1.0));
    return color * ring * (0.55 + value * 1.7) + color * inner * (0.04 + u.levels.x * 0.14);
}

fn oscilloscope(uv: vec2<f32>) -> vec3<f32> {
    let waveform_y = 0.5 + waveform_value(uv.x) * 0.32;
    let pixel = 1.0 / max(u.resolution_time.y, 1.0);
    let line = 1.0 - smoothstep(pixel * u.transform.y, pixel * (u.transform.y + 3.0), abs(uv.y - waveform_y));
    let spectrum_floor = spectrum_value(uv.x) * 0.22;
    let floor_fill = 1.0 - smoothstep(spectrum_floor, spectrum_floor + 0.015, uv.y);
    let grid_x = 1.0 - smoothstep(0.0, 0.04, abs(fract(uv.x * 16.0) - 0.5));
    let grid_y = 1.0 - smoothstep(0.0, 0.04, abs(fract(uv.y * 10.0) - 0.5));
    let color = hsv_to_rgb(vec3<f32>(u.transform.x + u.levels.w * 0.24, 0.72, 1.0));
    return color * line * (0.8 + u.levels.y * 1.2)
        + hsv_to_rgb(vec3<f32>(u.transform.x + 0.2, 0.82, 0.85)) * floor_fill * 0.55
        + vec3<f32>(0.03, 0.05, 0.07) * max(grid_x, grid_y) * 0.25;
}

fn spectral_field(uv: vec2<f32>) -> vec3<f32> {
    var position = (uv - 0.5) * 2.0;
    position.x *= u.resolution_time.x / max(u.resolution_time.y, 1.0);
    position = rotate2(position / max(u.transform.z, 0.01), u.transform.w + u.bands.y * 0.3);
    let time = u.resolution_time.z;
    let bass = u.bands.x;
    let low_mid = u.bands.y;
    let high_mid = u.bands.z;
    let treble = u.bands.w;
    let radial = length(position);
    let angle = atan2(position.y, position.x);
    let frequency_probe = fract(angle / 6.2831853 + radial * 0.22 + 0.5);
    let sampled = spectrum_value(frequency_probe);
    let waves = sin(position.x * (4.0 + high_mid * 12.0) + time * (0.35 + treble * 2.0))
        + sin(position.y * (5.0 + low_mid * 9.0) - time * (0.24 + bass * 1.4))
        + sin(radial * (11.0 + sampled * 20.0) - time * (0.55 + u.levels.w * 2.0));
    let contour = 0.5 + 0.5 * sin(waves * 1.8 + sampled * 5.0);
    let pulse = exp(-radial * (1.2 + bass * 2.2)) * (0.15 + bass * 1.4 + u.levels.z * 0.7);
    let color = hsv_to_rgb(vec3<f32>(u.transform.x + contour * 0.18 + sampled * 0.22, 0.78, contour));
    return color * (0.25 + sampled * 1.4) + hsv_to_rgb(vec3<f32>(u.transform.x + 0.52, 0.5, 1.0)) * pulse;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let uv = position.xy / resolution;
    let mode = u32(round(u.visual.w));
    var color = vec3<f32>(0.0);
    if (mode == 0u) {
        color = spectrum_bars(uv);
    } else if (mode == 1u) {
        color = radial_spectrum(uv);
    } else if (mode == 2u) {
        color = oscilloscope(uv);
    } else {
        color = spectral_field(uv);
    }
    let vignette = 1.0 - smoothstep(0.45, 0.9, length(uv - 0.5));
    color *= 0.72 + vignette * 0.28;
    color *= u.visual.z * (1.0 + u.levels.z * 0.35);
    color = color / (vec3<f32>(1.0) + color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
    return vec4<f32>(color, 1.0);
}
