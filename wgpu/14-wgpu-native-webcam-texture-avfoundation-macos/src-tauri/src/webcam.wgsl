struct Uniforms {
    viewport_source: vec4<f32>,
    transform: vec4<f32>,
    look: vec4<f32>,
    effects: vec4<f32>,
    timing: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var camera_tex: texture_2d<f32>;
@group(0) @binding(2) var camera_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0)
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn adjust_saturation(color: vec3<f32>, amount: f32) -> vec3<f32> {
    let gray = luminance(color);
    return mix(vec3<f32>(gray), color, amount);
}

fn rotate_quarter(uv: vec2<f32>, turns: i32) -> vec2<f32> {
    if (turns == 1) { return vec2<f32>(uv.y, 1.0 - uv.x); }
    if (turns == 2) { return vec2<f32>(1.0 - uv.x, 1.0 - uv.y); }
    if (turns == 3) { return vec2<f32>(1.0 - uv.y, uv.x); }
    return uv;
}

fn display_uv(position: vec2<f32>) -> vec3<f32> {
    let viewport = max(u.viewport_source.xy, vec2<f32>(1.0));
    var source = max(u.viewport_source.zw, vec2<f32>(1.0));
    let turns = i32(round(u.transform.w)) % 4;
    if (turns == 1 || turns == 3) { source = source.yx; }
    let screen_aspect = viewport.x / viewport.y;
    let source_aspect = source.x / source.y;
    var display_scale = vec2<f32>(1.0);
    let fit_mode = u.transform.y;
    if (fit_mode < 0.5) {
        if (screen_aspect > source_aspect) { display_scale.x = source_aspect / screen_aspect; }
        else { display_scale.y = screen_aspect / source_aspect; }
    } else if (fit_mode < 1.5) {
        if (screen_aspect > source_aspect) { display_scale.y = screen_aspect / source_aspect; }
        else { display_scale.x = source_aspect / screen_aspect; }
    }
    var centered = (position / viewport) * 2.0 - 1.0;
    centered /= max(display_scale, vec2<f32>(0.0001));
    centered /= max(u.transform.x, 0.0001);
    var uv = centered * 0.5 + 0.5;
    if (u.transform.z > 0.5) { uv.x = 1.0 - uv.x; }
    uv = rotate_quarter(uv, turns);
    let inside = select(0.0, 1.0, all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0)));
    return vec3<f32>(uv, inside);
}

fn sample_camera(uv: vec2<f32>) -> vec3<f32> {
    return textureSample(camera_tex, camera_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
}

fn edge_value(uv: vec2<f32>) -> f32 {
    let texel = 1.0 / max(u.viewport_source.zw, vec2<f32>(1.0));
    let left = luminance(sample_camera(uv - vec2<f32>(texel.x, 0.0)));
    let right = luminance(sample_camera(uv + vec2<f32>(texel.x, 0.0)));
    let up = luminance(sample_camera(uv - vec2<f32>(0.0, texel.y)));
    let down = luminance(sample_camera(uv + vec2<f32>(0.0, texel.y)));
    let gx = right - left;
    let gy = down - up;
    return length(vec2<f32>(gx, gy));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let mapped = display_uv(position.xy);
    if (mapped.z < 0.5) {
        let stripe = 0.012 + 0.005 * sin((position.x + position.y) * 0.035);
        return vec4<f32>(vec3<f32>(stripe), 1.0);
    }
    let uv = mapped.xy;
    let mode = i32(round(u.look.w));
    let strength = u.effects.x;
    var color = sample_camera(uv);

    if (mode == 1) {
        let edge = edge_value(uv) * (4.0 * strength);
        color = mix(color * 0.18, vec3<f32>(edge, edge * 0.72, edge * 1.35), clamp(strength, 0.0, 1.0));
    } else if (mode == 2) {
        let source_luma = luminance(color);
        let centered = uv - vec2<f32>(0.5);
        let warped_uv = uv + centered * ((source_luma - 0.5) * 0.18 * strength);
        color = sample_camera(warped_uv);
    } else if (mode == 3) {
        let separation = vec2<f32>(u.effects.y * strength, 0.0);
        color = vec3<f32>(
            sample_camera(uv + separation).r,
            sample_camera(uv).g,
            sample_camera(uv - separation).b
        );
    } else if (mode == 4) {
        let levels = max(u.effects.w, 2.0);
        color = floor(color * levels) / max(levels - 1.0, 1.0);
    } else if (mode == 5) {
        let blocks = max(u.effects.z, 1.0);
        let grid = max(u.viewport_source.zw / blocks, vec2<f32>(1.0));
        let blocked_uv = (floor(uv * grid) + vec2<f32>(0.5)) / grid;
        color = sample_camera(blocked_uv);
    } else if (mode == 6) {
        let line = 0.82 + 0.18 * sin(position.y * 3.14159265);
        let modulation = 0.96 + 0.04 * sin(position.x * 0.035 + u.timing.x * 2.0);
        color *= mix(1.0, line * modulation, clamp(strength, 0.0, 1.0));
    }

    color *= u.look.x;
    color = (color - vec3<f32>(0.5)) * u.look.y + vec3<f32>(0.5);
    color = adjust_saturation(color, u.look.z);
    if (u.timing.z < 0.5) {
        let pulse = 0.04 + 0.02 * sin(length((position.xy / max(u.viewport_source.xy, vec2<f32>(1.0))) - vec2<f32>(0.5)) * 36.0 - u.timing.x * 2.0);
        color = vec3<f32>(pulse * 0.45, pulse * 0.7, pulse);
    }
    return vec4<f32>(max(color, vec3<f32>(0.0)), 1.0);
}
