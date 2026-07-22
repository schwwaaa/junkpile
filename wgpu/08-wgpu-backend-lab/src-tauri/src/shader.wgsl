struct Uniforms {
    resolution_time: vec4<f32>,
    params: vec4<f32>,
    backend_tint: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );

    var result: VertexOutput;
    result.clip_position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    return result;
}

fn hash21(position: vec2<f32>) -> f32 {
    let projected = dot(position, vec2<f32>(127.1, 311.7));
    return fract(sin(projected) * 43758.5453123);
}

fn noise2(position: vec2<f32>) -> f32 {
    let cell = floor(position);
    let local = fract(position);
    let interpolation = local * local * (3.0 - 2.0 * local);

    let a = hash21(cell);
    let b = hash21(cell + vec2<f32>(1.0, 0.0));
    let c = hash21(cell + vec2<f32>(0.0, 1.0));
    let d = hash21(cell + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, interpolation.x), mix(c, d, interpolation.x), interpolation.y);
}

fn fbm(position: vec2<f32>, octave_count: f32) -> f32 {
    var accumulated = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var sample_position = position;

    for (var octave: i32 = 0; octave < 12; octave = octave + 1) {
        if (f32(octave) >= octave_count) {
            break;
        }
        accumulated = accumulated + noise2(sample_position * frequency) * amplitude;
        sample_position = mat2x2<f32>(1.62, -1.17, 1.17, 1.62) * sample_position;
        frequency = frequency * 1.73;
        amplitude = amplitude * 0.52;
    }

    return accumulated;
}

@fragment
fn fs_main(@builtin(position) fragment_position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    var uv = fragment_position.xy / resolution;
    uv = uv * 2.0 - 1.0;
    uv.x = uv.x * resolution.x / resolution.y;

    let elapsed = u.resolution_time.z * u.params.y;
    let octave_count = clamp(u.params.x, 1.0, 12.0);
    let layer_count = clamp(u.params.z, 1.0, 8.0);

    var field = 0.0;
    var layer_weight = 0.58;
    var layer_position = uv * 1.45;

    for (var layer: i32 = 0; layer < 8; layer = layer + 1) {
        if (f32(layer) >= layer_count) {
            break;
        }

        let phase = elapsed * (0.10 + f32(layer) * 0.026);
        let offset = vec2<f32>(cos(phase), sin(phase * 1.17)) * (0.35 + f32(layer) * 0.08);
        field = field + fbm(layer_position + offset, octave_count) * layer_weight;
        layer_position = mat2x2<f32>(1.21, -0.42, 0.42, 1.21) * layer_position + vec2<f32>(0.13);
        layer_weight = layer_weight * 0.66;
    }

    let radial = length(uv);
    let ridge = pow(abs(sin(field * 7.0 - elapsed * 0.25)), 2.4);
    let wave = 0.5 + 0.5 * sin(field * 5.4 + radial * 3.2 - elapsed * 0.18);

    let base_a = vec3<f32>(0.025, 0.035, 0.075);
    let base_b = u.backend_tint.rgb;
    var color = mix(base_a, base_b, clamp(field * 0.82 + wave * 0.32, 0.0, 1.0));
    color = color + ridge * base_b * 0.55;
    color = color * (0.72 + 0.48 * (1.0 - smoothstep(0.15, 1.65, radial)));
    color = vec3<f32>(1.0) - exp(-color * max(u.params.w, 0.0));

    return vec4<f32>(color, 1.0);
}
