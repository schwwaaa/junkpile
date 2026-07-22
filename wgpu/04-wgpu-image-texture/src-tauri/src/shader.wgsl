struct Uniforms {
    viewport_source: vec4<f32>,
    transform: vec4<f32>,
    look: vec4<f32>,
    extras: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var source_tex: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0,-3.0), vec2<f32>(3.0,1.0), vec2<f32>(-1.0,1.0));
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn saturation(color: vec3<f32>, amount: f32) -> vec3<f32> {
    let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    return mix(vec3<f32>(luma), color, amount);
}

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let viewport = max(u.viewport_source.xy, vec2<f32>(1.0));
    let source = max(u.viewport_source.zw, vec2<f32>(1.0));
    let screen_aspect = viewport.x / viewport.y;
    let image_aspect = source.x / source.y;
    var display_scale = vec2<f32>(1.0);
    let fit_mode = u.transform.z;
    if (fit_mode < 0.5) {
        if (screen_aspect > image_aspect) { display_scale.x = image_aspect / screen_aspect; }
        else { display_scale.y = screen_aspect / image_aspect; }
    } else if (fit_mode < 1.5) {
        if (screen_aspect > image_aspect) { display_scale.y = screen_aspect / image_aspect; }
        else { display_scale.x = image_aspect / screen_aspect; }
    }
    var centered = (p.xy / viewport) * 2.0 - 1.0;
    centered /= max(display_scale, vec2<f32>(0.0001));
    centered /= max(u.transform.x, 0.0001);
    let angle = u.transform.y;
    let c = cos(angle);
    let s = sin(angle);
    centered = mat2x2<f32>(c, -s, s, c) * centered;
    let uv = centered * 0.5 + 0.5;
    let inside = all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0));
    if (!inside) {
        let bars = 0.012 + 0.006 * sin((p.x + p.y) * 0.04 + u.transform.w);
        return vec4<f32>(vec3<f32>(bars), 1.0);
    }
    var color = textureSample(source_tex, source_sampler, uv).rgb;
    color *= u.look.x;
    color = saturation(color, u.look.z);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(u.look.y, 0.001)));
    return vec4<f32>(color, 1.0);
}
