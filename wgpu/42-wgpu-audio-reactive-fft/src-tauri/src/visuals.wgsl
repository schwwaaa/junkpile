struct VisualUniforms {
    time_params: vec4<f32>,
    audio: vec4<f32>,
    beat: vec4<f32>,
    resolution: vec4<f32>,
    mode: vec4<u32>,
};

@group(0) @binding(0) var<uniform> u: VisualUniforms;
@group(0) @binding(1) var spectrum_tex: texture_2d<f32>;
@group(0) @binding(2) var waveform_tex: texture_2d<f32>;
@group(0) @binding(3) var audio_sampler: sampler;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0)
    );
    let p = positions[index];
    var out: VertexOut;
    out.position = vec4<f32>(p, 0.0, 1.0);
    out.uv = p * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    return out;
}

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn rot(p: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}
fn spectrum(x: f32) -> f32 {
    return textureSampleLevel(spectrum_tex, audio_sampler, vec2<f32>(clamp(x, 0.0, 1.0), 0.5), 0.0).r;
}
fn waveform(x: f32) -> f32 {
    return textureSampleLevel(waveform_tex, audio_sampler, vec2<f32>(fract(x), 0.5), 0.0).r * 2.0 - 1.0;
}
fn palette(t: f32) -> vec3<f32> {
    let h = u.time_params.w;
    return 0.52 + 0.48 * cos(6.2831853 * (vec3<f32>(0.00, 0.33, 0.67) + t + h));
}
fn hash21(p: vec2<f32>) -> f32 {
    let q = fract(p * vec2<f32>(123.34, 456.21));
    return fract((q.x + q.y) * (q.x + 34.345));
}
fn line_glow(distance_to_line: f32, width: f32) -> f32 {
    return 1.0 - smoothstep(width, width * 3.0, abs(distance_to_line));
}

fn spectrum_tunnel(p0: vec2<f32>, t: f32) -> vec3<f32> {
    let p = rot(p0, t * u.time_params.y);
    let radius = length(p) + 0.0001;
    let angle = atan2(p.y, p.x) / 6.2831853 + 0.5;
    let f = spectrum(fract(angle * 0.85 + 0.075));
    let rings = abs(fract(radius * (10.0 + u.audio.y * 14.0) - t * (0.35 + u.audio.x)) - 0.5);
    let ring = 1.0 - smoothstep(0.04 + f * 0.09, 0.14 + f * 0.15, rings);
    let spokes = pow(sat(0.5 + 0.5 * cos(angle * 6.2831853 * 24.0 + f * 10.0)), 9.0);
    let center = 0.06 / (radius + 0.025);
    let energy = ring * (0.25 + f * 2.2 * u.time_params.z) + spokes * f * 0.7 + center * u.beat.y;
    return palette(angle + radius * 0.2 + t * 0.03) * energy;
}

fn radial_bloom(p0: vec2<f32>, t: f32) -> vec3<f32> {
    let p = rot(p0, t * u.time_params.y);
    let radius = length(p);
    let angle = atan2(p.y, p.x) / 6.2831853 + 0.5;
    let f = spectrum(fract(angle));
    let petals = 0.48 + f * 0.55 * u.time_params.z + u.audio.y * 0.18;
    let boundary = petals * (0.72 + 0.28 * sin(angle * 6.2831853 * (8.0 + floor(u.audio.z * 12.0)) + t));
    let edge = line_glow(radius - boundary, 0.018 + u.beat.y * 0.025);
    let aura = exp(-7.0 * abs(radius - boundary)) * (0.3 + f * 1.5);
    let core = exp(-9.0 * radius) * (0.5 + u.beat.y * 2.0);
    return palette(angle + f * 0.25) * (edge * 1.7 + aura + core);
}

fn wave_scope(p0: vec2<f32>, t: f32) -> vec3<f32> {
    let p = rot(p0, t * u.time_params.y);
    let x = p.x * 0.5 + 0.5;
    let w0 = waveform(x + t * 0.015);
    let w1 = waveform(x * 1.7 - t * 0.011);
    let y0 = w0 * (0.28 + u.audio.x * 0.45) * u.time_params.z;
    let y1 = w1 * (0.16 + u.audio.z * 0.30) * u.time_params.z;
    let trace0 = line_glow(p.y - y0, 0.006 + u.audio.w * 0.015);
    let trace1 = line_glow(p.y + 0.38 - y1, 0.004 + u.audio.z * 0.012);
    let trace2 = line_glow(p.y - 0.38 + y1, 0.004 + u.audio.y * 0.012);
    let grid = pow(1.0 - abs(sin(p.x * 25.0) * sin(p.y * 25.0)), 32.0) * 0.15;
    return palette(x * 0.5 + t * 0.02) * (trace0 * 1.8 + trace1 + trace2 + grid + u.beat.y * 0.15);
}

fn bass_lattice(p0: vec2<f32>, t: f32) -> vec3<f32> {
    var p = rot(p0, t * u.time_params.y);
    let zoom = 3.0 + u.audio.y * 5.5 * u.time_params.z;
    p *= zoom;
    let cell = fract(p) - 0.5;
    let id = floor(p);
    let f = spectrum(fract((id.x * 0.071 + id.y * 0.113) * 0.5 + 0.5));
    let box_edge = max(abs(cell.x), abs(cell.y));
    let border = 1.0 - smoothstep(0.39 - f * 0.13, 0.48, box_edge);
    let hole = smoothstep(0.06 + u.beat.y * 0.07, 0.24 + f * 0.10, length(cell));
    let flicker = 0.65 + 0.35 * sin(hash21(id) * 15.0 + t * (1.0 + f * 4.0));
    let intensity = border * hole * flicker * (0.4 + f * 1.7) + u.audio.y * 0.15;
    return palette(hash21(id) + t * 0.02) * intensity;
}

fn spectral_nebula(p0: vec2<f32>, t: f32) -> vec3<f32> {
    var p = rot(p0, t * u.time_params.y * 0.35);
    var accum = 0.0;
    var weight = 0.55;
    var q = p;
    for (var i = 0; i < 6; i = i + 1) {
        let fi = f32(i);
        let f = spectrum(fract(length(q) * 0.13 + fi * 0.127 + t * 0.008));
        let field = sin(q.x * (2.2 + fi) + t * (0.18 + f)) * cos(q.y * (2.7 + fi * 0.7) - t * 0.14);
        accum += abs(field) * weight * (0.35 + f * 1.4 * u.time_params.z);
        q = rot(q * 1.62 + vec2<f32>(0.17, -0.11), 0.45 + f * 0.2);
        weight *= 0.58;
    }
    let cloud = pow(sat(accum * 0.75), 2.2);
    let stars = pow(hash21(floor((p + 1.0) * 140.0)), 28.0) * (0.5 + u.audio.w * 2.0);
    return palette(accum * 0.25 + length(p) * 0.16 + t * 0.012) * (cloud + stars + u.beat.y * 0.12);
}

fn frequency_mandala(p0: vec2<f32>, t: f32) -> vec3<f32> {
    let p = rot(p0, t * u.time_params.y);
    let r = length(p) + 0.0001;
    let a = atan2(p.y, p.x) / 6.2831853 + 0.5;
    let mirrored = abs(fract(a * 12.0) - 0.5) * 2.0;
    let f = spectrum(mirrored);
    let layers = abs(fract(r * (7.0 + f * 12.0) - t * 0.12) - 0.5);
    let petals = abs(sin(a * 6.2831853 * (6.0 + floor(u.audio.z * 18.0))));
    let geometry = 1.0 - smoothstep(0.08 + f * 0.05, 0.18 + f * 0.12, layers);
    let cut = smoothstep(0.12, 0.85, petals + f * 0.65);
    let center = exp(-6.5 * r) * (0.3 + u.beat.y * 2.2);
    return palette(a + r * 0.35 + f * 0.18) * (geometry * cut * (0.35 + f * 1.8 * u.time_params.z) + center);
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    var p = input.uv * 2.0 - 1.0;
    p.x *= aspect;
    let t = u.time_params.x;
    var color = vec3<f32>(0.0);
    switch u.mode.x {
        case 0u: { color = spectrum_tunnel(p, t); }
        case 1u: { color = radial_bloom(p, t); }
        case 2u: { color = wave_scope(p, t); }
        case 3u: { color = bass_lattice(p, t); }
        case 4u: { color = spectral_nebula(p, t); }
        default: { color = frequency_mandala(p, t); }
    }
    color *= 0.82 + u.audio.x * 0.9 + u.beat.y * 0.32;
    color = color / (1.0 + color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.86));
    return vec4<f32>(color, 1.0);
}
