struct Uniforms {
    grid_time: vec4<f32>,
    flow: vec4<f32>,
    emitter: vec4<f32>,
    motion: vec4<f32>,
    look: vec4<f32>,
    control: vec4<f32>,
    output: vec4<f32>,
    flags: vec4<u32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var field_texture: texture_2d<f32>;

@group(0) @binding(2)
var linear_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn signed_color(value: f32, scale: f32) -> vec3<f32> {
    let magnitude = clamp(abs(value) * scale, 0.0, 1.0);
    let positive = vec3<f32>(1.0, 0.16, 0.06);
    let negative = vec3<f32>(0.02, 0.42, 1.0);
    return select(negative, positive, value >= 0.0) * magnitude;
}

fn velocity_color(velocity: vec2<f32>) -> vec3<f32> {
    let magnitude = clamp(length(velocity) * 3.2, 0.0, 1.0);
    let direction = 0.5 + 0.5 * normalize(vec3<f32>(velocity, 0.0001));
    return direction * (0.18 + magnitude * 1.35);
}

fn sample_bloom(uv: vec2<f32>, texel: vec2<f32>) -> vec3<f32> {
    var accumulated = textureSampleLevel(field_texture, linear_sampler, uv, 0.0).rgb * 0.24;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(2.0, 0.0), 0.0).rgb * 0.11;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(-2.0, 0.0), 0.0).rgb * 0.11;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(0.0, 2.0), 0.0).rgb * 0.11;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(0.0, -2.0), 0.0).rgb * 0.11;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(1.5, 1.5), 0.0).rgb * 0.08;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(-1.5, 1.5), 0.0).rgb * 0.08;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(1.5, -1.5), 0.0).rgb * 0.08;
    accumulated += textureSampleLevel(field_texture, linear_sampler, uv + texel * vec2<f32>(-1.5, -1.5), 0.0).rgb * 0.08;
    return max(accumulated - vec3<f32>(0.20), vec3<f32>(0.0));
}

@fragment
fn fs_visualize(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let output_size = max(u.output.xy, vec2<f32>(1.0));
    let uv = position.xy / output_size;
    let raw_value = textureSampleLevel(field_texture, linear_sampler, uv, 0.0);
    let mode = u.flags.w;
    var color = raw_value.rgb;

    if (mode == 1u) {
        color = velocity_color(raw_value.xy);
    } else if (mode == 2u) {
        color = signed_color(raw_value.x, 7.0);
    } else if (mode == 3u) {
        color = signed_color(raw_value.x, 18.0);
    } else if (mode == 4u) {
        color = signed_color(raw_value.x, 10.0) + vec3<f32>(0.02, 0.01, 0.04);
    } else {
        let field_size = vec2<f32>(textureDimensions(field_texture, 0));
        let texel = vec2<f32>(1.0) / max(field_size, vec2<f32>(1.0));
        color += sample_bloom(uv, texel) * u.look.y;
    }

    return vec4<f32>(color, 1.0);
}

fn aces_tone_map(color: vec3<f32>) -> vec3<f32> {
    let numerator = color * (2.51 * color + vec3<f32>(0.03));
    let denominator = color * (2.43 * color + vec3<f32>(0.59)) + vec3<f32>(0.14);
    return clamp(numerator / denominator, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn stable_hash(position: vec2<f32>) -> f32 {
    return fract(sin(dot(position, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs_present(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let window_size = max(u.output.zw, vec2<f32>(1.0));
    let uv = position.xy / window_size;
    var color = textureSampleLevel(field_texture, linear_sampler, uv, 0.0).rgb;
    color *= max(u.look.x, 0.0);
    color = aces_tone_map(color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(u.look.z, 0.05)));

    let centered = uv - vec2<f32>(0.5);
    let radial = dot(centered, centered) * 2.0;
    color *= 1.0 - clamp(radial * u.look.w, 0.0, 0.82);

    let dither = (stable_hash(floor(position.xy)) - 0.5) / 255.0;
    color += vec3<f32>(dither);
    return vec4<f32>(color, 1.0);
}
