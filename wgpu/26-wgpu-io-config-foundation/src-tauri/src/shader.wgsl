struct Uniforms {
    timing: vec4<f32>,
    render: vec4<f32>,
    preview: vec4<f32>,
    recording: vec4<f32>,
    streaming: vec4<f32>,
    outputs: vec4<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0)
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn hash21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn aspect_box(uv: vec2<f32>, center: vec2<f32>, size: vec2<f32>, dimensions: vec2<f32>) -> f32 {
    let ratio = max(dimensions.x, 1.0) / max(dimensions.y, 1.0);
    var box_size = size;
    if (ratio > 1.0) {
        box_size.y /= ratio;
    } else {
        box_size.x *= ratio;
    }
    let local = abs(uv - center) - box_size;
    let distance = length(max(local, vec2<f32>(0.0))) + min(max(local.x, local.y), 0.0);
    return 1.0 - smoothstep(0.0, 0.012, abs(distance));
}

fn fill_box(uv: vec2<f32>, center: vec2<f32>, size: vec2<f32>, dimensions: vec2<f32>) -> f32 {
    let ratio = max(dimensions.x, 1.0) / max(dimensions.y, 1.0);
    var box_size = size;
    if (ratio > 1.0) {
        box_size.y /= ratio;
    } else {
        box_size.x *= ratio;
    }
    let local = abs(uv - center) - box_size;
    let distance = length(max(local, vec2<f32>(0.0))) + min(max(local.x, local.y), 0.0);
    return 1.0 - smoothstep(-0.01, 0.01, distance);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let surface = max(u.render.zw, vec2<f32>(1.0));
    let uv = position.xy / surface;
    let time = u.timing.x;
    let generation = u.timing.z;

    let grid_uv = position.xy / 32.0;
    let grid_line = max(
        1.0 - smoothstep(0.0, 0.08, abs(fract(grid_uv.x) - 0.5)),
        1.0 - smoothstep(0.0, 0.08, abs(fract(grid_uv.y) - 0.5))
    );
    var color = vec3<f32>(0.018, 0.024, 0.038) + grid_line * 0.025;

    let pulse = 0.55 + 0.45 * sin(time * 1.6 + generation * 0.7);
    let generation_tint = vec3<f32>(0.13, 0.45, 0.78) + vec3<f32>(0.12, 0.05, 0.18) * pulse;

    let preview_center = vec2<f32>(0.27, 0.30);
    let recording_center = vec2<f32>(0.73, 0.30);
    let streaming_center = vec2<f32>(0.27, 0.72);
    let render_center = vec2<f32>(0.73, 0.72);
    let box_size = vec2<f32>(0.19, 0.16);

    let preview_fill = fill_box(uv, preview_center, box_size, u.preview.xy);
    let preview_border = aspect_box(uv, preview_center, box_size, u.preview.xy);
    let record_fill = fill_box(uv, recording_center, box_size, u.recording.xy);
    let record_border = aspect_box(uv, recording_center, box_size, u.recording.xy);
    let stream_fill = fill_box(uv, streaming_center, box_size, u.streaming.xy);
    let stream_border = aspect_box(uv, streaming_center, box_size, u.streaming.xy);
    let render_fill = fill_box(uv, render_center, box_size, u.render.xy);
    let render_border = aspect_box(uv, render_center, box_size, u.render.xy);

    color = mix(color, vec3<f32>(0.04, 0.20, 0.28), preview_fill * 0.62);
    color += preview_border * mix(vec3<f32>(0.22), vec3<f32>(0.36, 0.92, 1.0), u.preview.z);

    color = mix(color, vec3<f32>(0.20, 0.09, 0.26), record_fill * 0.58);
    color += record_border * mix(vec3<f32>(0.22), vec3<f32>(0.88, 0.46, 1.0), u.recording.z);

    color = mix(color, vec3<f32>(0.08, 0.20, 0.15), stream_fill * 0.58);
    color += stream_border * mix(vec3<f32>(0.22), vec3<f32>(0.32, 1.0, 0.64), u.streaming.z);

    color = mix(color, generation_tint * 0.42, render_fill * 0.56);
    color += render_border * vec3<f32>(0.98, 0.72, 0.25);

    let center_glow = exp(-5.5 * length(uv - vec2<f32>(0.5)));
    color += generation_tint * center_glow * 0.18;

    let output_activity = max(u.outputs.x, u.outputs.y);
    let ring_distance = abs(length(uv - vec2<f32>(0.5)) - 0.08);
    let ring = 1.0 - smoothstep(0.004, 0.012, ring_distance);
    color += ring * mix(vec3<f32>(0.18), vec3<f32>(1.0, 0.55, 0.20), output_activity);

    let grain = hash21(position.xy + generation) - 0.5;
    color += grain * 0.018;
    return vec4<f32>(pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.92)), 1.0);
}
