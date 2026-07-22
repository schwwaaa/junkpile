struct Uniforms {
    data: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0,-3.0), vec2<f32>(3.0,1.0), vec2<f32>(-1.0,1.0));
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.data.yz, vec2<f32>(1.0));
    let uv = p.xy / resolution;
    let cells = floor(uv * vec2<f32>(16.0, 9.0));
    let checker = f32((i32(cells.x) + i32(cells.y)) & 1);
    let line_x = 1.0 - smoothstep(0.0, 0.025, abs(fract(uv.x * 16.0) - 0.5));
    let line_y = 1.0 - smoothstep(0.0, 0.025, abs(fract(uv.y * 9.0) - 0.5));
    let pulse = 0.5 + 0.5 * sin(u.data.x * 1.2);
    let base = mix(vec3<f32>(0.025,0.045,0.09), vec3<f32>(0.08,0.16,0.25), checker * 0.38);
    let grid = max(line_x, line_y) * vec3<f32>(0.10, 0.45, 0.62);
    let cross = 1.0 - smoothstep(0.0, 0.004, min(abs(uv.x - 0.5), abs(uv.y - 0.5)));
    return vec4<f32>(base + grid * (0.35 + pulse * 0.25) + cross * vec3<f32>(0.45,0.20,0.65), 1.0);
}
