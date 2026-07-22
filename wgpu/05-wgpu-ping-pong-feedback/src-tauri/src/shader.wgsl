struct Uniforms {
    resolution_time: vec4<f32>,
    feedback: vec4<f32>,
    motion: vec4<f32>,
    look: vec4<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var previous_tex: texture_2d<f32>;
@group(0) @binding(2) var previous_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn hash21(point: vec2<f32>) -> f32 {
    return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn noise(point: vec2<f32>) -> f32 {
    let cell = floor(point);
    let local = fract(point);
    let smooth = local * local * (3.0 - 2.0 * local);
    return mix(
        mix(
            hash21(cell),
            hash21(cell + vec2<f32>(1.0, 0.0)),
            smooth.x,
        ),
        mix(
            hash21(cell + vec2<f32>(0.0, 1.0)),
            hash21(cell + vec2<f32>(1.0, 1.0)),
            smooth.x,
        ),
        smooth.y,
    );
}

fn hsv_to_rgb(color: vec3<f32>) -> vec3<f32> {
    let phase = abs(
        fract(color.xxx + vec3<f32>(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0,
    );
    return color.z * mix(
        vec3<f32>(1.0),
        clamp(phase - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)),
        color.y,
    );
}

fn saturate_color(color: vec3<f32>, amount: f32) -> vec3<f32> {
    let luminance = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    return mix(vec3<f32>(luminance), color, amount);
}

@fragment
fn fs_feedback(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let uv = position.xy / resolution;

    var feedback_uv = uv - 0.5;
    feedback_uv /= max(u.feedback.y, 0.0001);
    let cosine = cos(u.feedback.z);
    let sine = sin(u.feedback.z);
    feedback_uv = mat2x2<f32>(cosine, -sine, sine, cosine) * feedback_uv;
    feedback_uv = feedback_uv + 0.5 + u.motion.xy;

    var previous = textureSample(previous_tex, previous_sampler, feedback_uv).rgb;
    previous *= u.feedback.x;

    let aspect = resolution.x / resolution.y;
    let domain = (uv - 0.5) * vec2<f32>(aspect, 1.0) * u.look.z;
    let time = u.resolution_time.z;
    let noise_a = noise(domain * 4.0 + vec2<f32>(time * 0.18, -time * 0.13));
    let noise_b = noise(domain * 9.0 + vec2<f32>(-time * 0.09, time * 0.21));
    let pulse = smoothstep(0.70, 0.98, noise_a * 0.72 + noise_b * 0.28);
    let hue = fract(0.56 + noise_a * 0.32 + time * 0.012 + length(domain) * 0.04);
    let source = hsv_to_rgb(vec3<f32>(hue, 0.82, pulse * 1.7)) * u.feedback.w;

    var color = previous + source;
    color = saturate_color(color, u.motion.w) * u.motion.z;
    return vec4<f32>(color, 1.0);
}

@fragment
fn fs_present(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let uv = position.xy / resolution;
    var color = textureSample(previous_tex, previous_sampler, uv).rgb;
    color = color / (vec3<f32>(1.0) + color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.86));
    return vec4<f32>(color, 1.0);
}
