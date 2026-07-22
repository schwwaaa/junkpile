struct Uniforms {
    resolution_time: vec4<f32>,
    blur: vec4<f32>,
    source: vec4<f32>,
    look: vec4<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var input_tex: texture_2d<f32>;
@group(0) @binding(2) var bloom_tex: texture_2d<f32>;
@group(0) @binding(3) var linear_sampler: sampler;

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

    for (var index = 0; index < 8; index = index + 1) {
        if (f32(index) >= octaves) {
            break;
        }
        value += amplitude * noise(position);
        position = mat2x2<f32>(1.6, 1.2, -1.2, 1.6) * position;
        amplitude *= 0.5;
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
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    var uv = (2.0 * position.xy - resolution) / min(resolution.x, resolution.y);
    uv *= u.source.x;

    let time = u.resolution_time.z * u.source.y;
    let warp = vec2<f32>(
        fbm(uv + vec2<f32>(time * 0.12, 0.0), u.source.w),
        fbm(uv + vec2<f32>(3.7, -time * 0.1), u.source.w),
    );
    let field = fbm(uv + warp * 2.8, u.source.w);
    let hue = fract(u.source.z / 360.0 + field * 0.35 + time * 0.015);
    let color = hsv_to_rgb(vec3<f32>(hue, 0.84, 0.2 + field * 1.7));

    return vec4<f32>(color, 1.0);
}

fn blur9(uv: vec2<f32>, direction: vec2<f32>) -> vec3<f32> {
    let texel = direction / max(u.resolution_time.xy, vec2<f32>(1.0)) * u.blur.x;
    var color = textureSample(input_tex, linear_sampler, uv).rgb * 0.227027;
    color += textureSample(input_tex, linear_sampler, uv + texel * 1.384615).rgb * 0.316216;
    color += textureSample(input_tex, linear_sampler, uv - texel * 1.384615).rgb * 0.316216;
    color += textureSample(input_tex, linear_sampler, uv + texel * 3.230769).rgb * 0.070270;
    color += textureSample(input_tex, linear_sampler, uv - texel * 3.230769).rgb * 0.070270;
    return color;
}

@fragment
fn fs_blur_h(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = position.xy / max(u.resolution_time.xy, vec2<f32>(1.0));
    return vec4<f32>(blur9(uv, vec2<f32>(1.0, 0.0)), 1.0);
}

@fragment
fn fs_blur_v(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = position.xy / max(u.resolution_time.xy, vec2<f32>(1.0));
    return vec4<f32>(blur9(uv, vec2<f32>(0.0, 1.0)), 1.0);
}

@fragment
fn fs_composite(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let uv = position.xy / resolution;
    let chromatic_shift = vec2<f32>(u.blur.z, 0.0);

    let red = textureSample(input_tex, linear_sampler, uv + chromatic_shift).r;
    let green = textureSample(input_tex, linear_sampler, uv).g;
    let blue = textureSample(input_tex, linear_sampler, uv - chromatic_shift).b;
    var color = vec3<f32>(red, green, blue);

    let bloom = textureSample(bloom_tex, linear_sampler, uv).rgb;
    color = (color + bloom * u.blur.y) * u.look.x;
    color = color / (vec3<f32>(1.0) + color);

    // Keep display grain spatially stable. Adding the frame index here
    // translates the noise field diagonally every frame and appears as rolling.
    let grain_pixel = floor(position.xy);
    let grain = (hash21(grain_pixel) - 0.5) * u.look.z;
    color += vec3<f32>(grain);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(u.look.y));

    return vec4<f32>(color, 1.0);
}
