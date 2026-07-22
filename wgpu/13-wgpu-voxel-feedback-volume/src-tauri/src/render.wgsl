struct Uniforms {
    volume_time: vec4<f32>,
    behavior: vec4<f32>,
    motion: vec4<f32>,
    camera: vec4<f32>,
    render: vec4<f32>,
    look: vec4<f32>,
    output: vec4<f32>,
    slice: vec4<f32>,
    flags: vec4<u32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var volume_tex: texture_3d<f32>;
@group(0) @binding(2) var volume_sampler: sampler;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
    let position = positions[vertex_index];
    var out: VertexOut;
    out.position = vec4<f32>(position, 0.0, 1.0);
    out.uv = position * 0.5 + vec2<f32>(0.5);
    return out;
}

fn rotate_y(v: vec3<f32>, angle: f32) -> vec3<f32> {
    let c = cos(angle); let s = sin(angle);
    return vec3<f32>(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
fn rotate_x(v: vec3<f32>, angle: f32) -> vec3<f32> {
    let c = cos(angle); let s = sin(angle);
    return vec3<f32>(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

fn ray_box(origin: vec3<f32>, direction: vec3<f32>) -> vec2<f32> {
    let inv = vec3<f32>(1.0) / direction;
    let t0 = (-vec3<f32>(1.0) - origin) * inv;
    let t1 = ( vec3<f32>(1.0) - origin) * inv;
    let near_v = min(t0, t1);
    let far_v = max(t0, t1);
    return vec2<f32>(max(max(near_v.x, near_v.y), near_v.z), min(min(far_v.x, far_v.y), far_v.z));
}

fn sample_volume(p: vec3<f32>) -> vec4<f32> {
    return textureSampleLevel(volume_tex, volume_sampler, p * 0.5 + vec3<f32>(0.5), 0.0);
}

fn density_gradient(p: vec3<f32>) -> vec3<f32> {
    let e = 2.0 / max(u.volume_time.x, 1.0);
    let dx = sample_volume(p + vec3<f32>(e, 0.0, 0.0)).a - sample_volume(p - vec3<f32>(e, 0.0, 0.0)).a;
    let dy = sample_volume(p + vec3<f32>(0.0, e, 0.0)).a - sample_volume(p - vec3<f32>(0.0, e, 0.0)).a;
    let dz = sample_volume(p + vec3<f32>(0.0, 0.0, e)).a - sample_volume(p - vec3<f32>(0.0, 0.0, e)).a;
    return normalize(vec3<f32>(dx, dy, dz) + vec3<f32>(0.0001));
}

fn slice_color(uv: vec2<f32>, mode: u32) -> vec3<f32> {
    let depth = clamp(u.slice.x, 0.0, 1.0);
    let thickness = max(u.slice.y, 0.002);
    var color = vec3<f32>(0.0);
    var weight = 0.0;
    for (var i = -4; i <= 4; i = i + 1) {
        let d = depth + f32(i) * thickness * 0.125;
        var coord = vec3<f32>(uv, d);
        if (mode == 2u) { coord = vec3<f32>(uv.x, d, uv.y); }
        let value = textureSampleLevel(volume_tex, volume_sampler, clamp(coord, vec3<f32>(0.0), vec3<f32>(1.0)), 0.0);
        color += value.rgb;
        weight += 1.0;
    }
    return color / max(weight, 1.0) * u.render.x;
}

@fragment
fn fs_volume(input: VertexOut) -> @location(0) vec4<f32> {
    let view_mode = u.flags.y;
    if (view_mode == 1u || view_mode == 2u) {
        return vec4<f32>(slice_color(input.uv, view_mode), 1.0);
    }

    let aspect = u.output.x / max(u.output.y, 1.0);
    let ndc = (input.uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
    let fov_scale = tan(u.camera.w * 0.5);
    var ray_direction = normalize(vec3<f32>(ndc * fov_scale, -1.0));
    var camera_origin = vec3<f32>(0.0, 0.0, u.camera.z);
    let orbit = u.camera.x + u.volume_time.z * u.motion.z;
    camera_origin = rotate_y(rotate_x(camera_origin, u.camera.y), orbit);
    ray_direction = rotate_y(rotate_x(ray_direction, u.camera.y), orbit);

    let bounds = ray_box(camera_origin, ray_direction);
    if (bounds.x > bounds.y || bounds.y < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    var t = max(bounds.x, 0.0);
    let end_t = bounds.y;
    let steps = u32(clamp(u.render.y, 16.0, 512.0));
    let step_size = max((end_t - t) / f32(steps), 0.002);
    var accumulated = vec4<f32>(0.0);
    var maximum_sample = vec4<f32>(0.0);
    var surface_color = vec3<f32>(0.0);
    var surface_hit = false;

    for (var i = 0u; i < 512u; i = i + 1u) {
        if (i >= steps || t > end_t || accumulated.a > 0.995) { break; }
        let p = camera_origin + ray_direction * t;
        let voxel = sample_volume(p);
        maximum_sample = select(maximum_sample, voxel, voxel.a > maximum_sample.a);
        if (view_mode == 4u && !surface_hit && voxel.a > u.look.w) {
            let normal = density_gradient(p);
            let light = normalize(vec3<f32>(0.55, 0.8, 0.35));
            let diffuse = max(dot(normal, light), 0.0);
            surface_color = voxel.rgb * (0.28 + 1.6 * diffuse);
            surface_hit = true;
        }
        let density = max(voxel.a - u.look.w * 0.15, 0.0) * u.render.x;
        let alpha = 1.0 - exp(-density * step_size * 3.0);
        let fog = exp(-u.look.z * t * t);
        let sample_color = voxel.rgb * fog;
        let remaining = 1.0 - accumulated.a;
        let next_rgb = accumulated.rgb + remaining * sample_color * alpha;
        let next_alpha = accumulated.a + remaining * alpha;
        accumulated = vec4<f32>(next_rgb, next_alpha);
        t += step_size;
    }

    var color = accumulated.rgb;
    if (view_mode == 3u) { color = maximum_sample.rgb * u.render.x; }
    if (view_mode == 4u) {
        color = vec3<f32>(0.0);
        if (surface_hit) { color = surface_color; }
    }
    let hue = u.look.x;
    color = vec3<f32>(color.r + color.g * hue * 0.08, color.g + color.b * hue * 0.06, color.b + color.r * hue * 0.05);
    return vec4<f32>(color, 1.0);
}
