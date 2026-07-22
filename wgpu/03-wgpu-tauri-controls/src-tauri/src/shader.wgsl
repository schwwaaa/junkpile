struct Uniforms {
    timing: vec4<f32>,
    image: vec4<f32>,
    look: vec4<f32>,
    extras: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0,-3.0), vec2<f32>(3.0,1.0), vec2<f32>(-1.0,1.0));
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}
fn hash21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1,311.7))) * 43758.5453); }
fn noise(p: vec2<f32>) -> f32 {
    let i=floor(p); let f=fract(p); let s=f*f*(3.0-2.0*f);
    return mix(mix(hash21(i),hash21(i+vec2<f32>(1.0,0.0)),s.x),mix(hash21(i+vec2<f32>(0.0,1.0)),hash21(i+vec2<f32>(1.0,1.0)),s.x),s.y);
}
fn fbm(input: vec2<f32>, octaves: f32) -> f32 {
    var p=input; var value=0.0; var amplitude=0.5;
    for (var i=0; i<8; i=i+1) {
        if (f32(i) >= octaves) { break; }
        value += amplitude * noise(p); p = mat2x2<f32>(1.6,1.2,-1.2,1.6) * p; amplitude *= 0.5;
    }
    return value;
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
    let p = abs(fract(c.xxx + vec3<f32>(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
    return c.z * mix(vec3<f32>(1.0), clamp(p - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}
@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution=max(u.image.xy,vec2<f32>(1.0));
    var uv=(2.0*p.xy-resolution)/min(resolution.x,resolution.y);
    uv *= u.image.z;
    let time=u.timing.x*u.timing.y;
    let q=vec2<f32>(fbm(uv*1.6+time*0.11,u.extras.x),fbm(uv*1.6+vec2<f32>(4.2,1.3)-time*0.09,u.extras.x));
    let r=vec2<f32>(fbm(uv*1.9+q*(1.0+u.image.w*3.2)+vec2<f32>(1.7,9.2)+time*0.08,u.extras.x),fbm(uv*1.9+q*(1.0+u.image.w*2.8)+vec2<f32>(8.3,2.8)-time*0.07,u.extras.x));
    let f=fbm(uv*1.25+r*(1.0+u.image.w*3.8),u.extras.x);
    let hue=fract(u.look.x/360.0+f*0.26+length(q)*0.08+time*0.01);
    var color=hsv2rgb(vec3<f32>(hue,u.look.z,clamp((0.25+f*1.15)*u.look.y,0.0,3.0)));
    color += u.look.w * 0.035 / (0.055 + length(uv));
    if (u.extras.y > 0.5) { color *= 0.72 + 0.28 * sin(time * 15.70795); }
    return vec4<f32>(pow(max(color,vec3<f32>(0.0)),vec3<f32>(0.88)),1.0);
}
