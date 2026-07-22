struct Uniforms {
    internal_time: vec4<f32>,
    params: vec4<f32>,
    window: vec4<f32>,
    extras: vec4<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var highres_tex: texture_2d<f32>;
@group(0) @binding(2) var linear_sampler: sampler;

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
    let interpolation = local * local * (3.0 - 2.0 * local);
    return mix(
        mix(
            hash21(cell),
            hash21(cell + vec2<f32>(1.0, 0.0)),
            interpolation.x,
        ),
        mix(
            hash21(cell + vec2<f32>(0.0, 1.0)),
            hash21(cell + vec2<f32>(1.0, 1.0)),
            interpolation.x,
        ),
        interpolation.y,
    );
}

fn fbm(point: vec2<f32>, octaves: f32) -> f32 {
    var position = point;
    var amplitude = 0.5;
    var value = 0.0;

    for (var index = 0; index < 12; index = index + 1) {
        if (f32(index) >= octaves) {
            break;
        }
        value += amplitude * noise(position);
        position = mat2x2<f32>(1.62, 1.18, -1.18, 1.62) * position;
        amplitude *= 0.52;
    }

    return value;
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

@fragment
fn fs_source(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.internal_time.xy, vec2<f32>(1.0));
    var uv = (2.0 * position.xy - resolution) / min(resolution.x, resolution.y);
    let time = u.internal_time.z * u.params.y;

    let base = fbm(
        uv * u.params.w + vec2<f32>(time * 0.08, -time * 0.06),
        u.params.x,
    );
    let warp = vec2<f32>(
        fbm(
            uv * u.params.w + vec2<f32>(2.1, 5.7) + vec2<f32>(time * 0.05),
            u.params.x,
        ),
        fbm(
            uv * u.params.w + vec2<f32>(8.3, 1.4) - vec2<f32>(time * 0.04),
            u.params.x,
        ),
    );
    let field = fbm(uv * u.params.w + warp * 3.5, u.params.x);
    let lines = 0.5
        + 0.5 * sin((field * 8.0 + length(uv) * 5.0 - time * 0.3) * 6.28318);
    let hue = fract(0.52 + base * 0.22 + field * 0.31 + time * 0.008);

    var color = hsv_to_rgb(vec3<f32>(
        hue,
        0.88,
        0.12 + field * 1.55 + lines * 0.18,
    ));
    color *= u.params.z;
    return vec4<f32>(color, 1.0);
}

@fragment
fn fs_present(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let window_size = max(u.window.xy, vec2<f32>(1.0));
    let uv = position.xy / window_size;
    var color = textureSample(highres_tex, linear_sampler, uv).rgb;
    color = color / (vec3<f32>(1.0) + color);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.88));
    return vec4<f32>(color, 1.0);
}
