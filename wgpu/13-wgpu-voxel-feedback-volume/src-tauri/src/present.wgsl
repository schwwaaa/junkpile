struct Uniforms {
    volume_time: vec4<f32>, behavior: vec4<f32>, motion: vec4<f32>, camera: vec4<f32>, render: vec4<f32>, look: vec4<f32>, output: vec4<f32>, slice: vec4<f32>, flags: vec4<u32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var hdr_tex: texture_2d<f32>;
@group(0) @binding(2) var hdr_sampler: sampler;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
    let position = positions[vertex_index]; var out: VertexOut; out.position = vec4<f32>(position, 0.0, 1.0); out.uv = position * 0.5 + vec2<f32>(0.5); return out;
}
fn aces(x: vec3<f32>) -> vec3<f32> { let a=2.51; let b=0.03; let c=2.43; let d=0.59; let e=0.14; return clamp((x*(a*x+vec3<f32>(b)))/(x*(c*x+vec3<f32>(d))+vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0)); }
@fragment fn fs_present(input: VertexOut) -> @location(0) vec4<f32> {
    let texel = 1.0 / max(u.output.xy, vec2<f32>(1.0));
    var color = textureSample(hdr_tex, hdr_sampler, input.uv).rgb;
    let bloom = textureSample(hdr_tex, hdr_sampler, input.uv + texel * vec2<f32>(2.0,0.0)).rgb + textureSample(hdr_tex, hdr_sampler, input.uv - texel * vec2<f32>(2.0,0.0)).rgb + textureSample(hdr_tex, hdr_sampler, input.uv + texel * vec2<f32>(0.0,2.0)).rgb + textureSample(hdr_tex, hdr_sampler, input.uv - texel * vec2<f32>(0.0,2.0)).rgb;
    color += max(bloom * 0.25 - vec3<f32>(0.35), vec3<f32>(0.0)) * u.render.w;
    color = aces(color * u.render.z);
    let vignette = 1.0 - 0.28 * dot(input.uv - vec2<f32>(0.5), input.uv - vec2<f32>(0.5));
    color *= vignette;
    return vec4<f32>(pow(color, vec3<f32>(1.0/2.2)), 1.0);
}
