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
@group(0) @binding(1) var source_volume: texture_3d<f32>;
@group(0) @binding(2) var target_volume: texture_storage_3d<rgba16float, write>;

fn hash31(p: vec3<f32>) -> f32 {
    var q = fract(p * 0.1031);
    q += dot(q, q.yzx + vec3<f32>(33.33));
    return fract((q.x + q.y) * q.z);
}

fn palette(t: f32, scene: u32) -> vec3<f32> {
    if (scene == 1u) { return vec3<f32>(1.15, 0.28, 0.08) * (0.35 + t) + vec3<f32>(0.08, 0.02, 0.16); }
    if (scene == 2u) { return vec3<f32>(0.08, 0.75, 1.3) * (0.3 + t) + vec3<f32>(0.35, 0.02, 0.55); }
    if (scene == 3u) { return vec3<f32>(0.5 + 0.7 * t, 1.1 - 0.35 * t, 0.12 + 0.45 * t); }
    return vec3<f32>(0.18, 0.55, 1.25) * (0.25 + t) + vec3<f32>(0.45, 0.04, 0.38);
}

fn sdf_sphere(p: vec3<f32>, r: f32) -> f32 { return length(p) - r; }
fn sdf_torus(p: vec3<f32>, major_radius: f32, minor_radius: f32) -> f32 {
    let q = vec2<f32>(length(p.xz) - major_radius, p.y);
    return length(q) - minor_radius;
}

fn scene_source(p: vec3<f32>, time: f32, scene: u32) -> vec4<f32> {
    var density = 0.0;
    var color = vec3<f32>(0.0);
    if (scene == 0u) {
        let c1 = vec3<f32>(0.45 * sin(time * 0.77), 0.4 * cos(time * 0.61), 0.45 * sin(time * 0.43));
        let c2 = vec3<f32>(0.42 * cos(time * 0.39), 0.35 * sin(time * 0.91), 0.42 * cos(time * 0.57));
        let d = min(sdf_sphere(p - c1, 0.22), sdf_sphere(p - c2, 0.18));
        density = exp(-45.0 * max(d, 0.0)) * select(1.0, 0.35, d < 0.0);
        color = palette(length(p), scene);
    } else if (scene == 1u) {
        let q = vec3<f32>(p.x * cos(time * 0.17) - p.z * sin(time * 0.17), p.y, p.x * sin(time * 0.17) + p.z * cos(time * 0.17));
        let d = min(sdf_torus(q, 0.48, 0.13), sdf_sphere(q + vec3<f32>(0.0, 0.28, 0.0), 0.43));
        density = exp(-34.0 * abs(d)) * 0.9;
        color = palette(0.5 + 0.5 * sin(8.0 * q.y + time), scene);
    } else if (scene == 2u) {
        let radius = length(p.xy);
        let helix = abs(radius - (0.42 + 0.08 * sin(7.0 * p.z + time))) - 0.055;
        density = exp(-65.0 * max(helix, 0.0));
        color = palette(0.5 + 0.5 * sin(9.0 * p.z + time), scene);
    } else {
        let cell = floor((p + vec3<f32>(1.0)) * 7.0);
        let local = fract((p + vec3<f32>(1.0)) * 7.0) - vec3<f32>(0.5);
        let life = hash31(cell + floor(time * 0.7));
        let d = length(local) - (0.12 + 0.22 * life);
        density = select(0.0, exp(-30.0 * max(d, 0.0)), life > 0.64);
        color = palette(life, scene);
    }
    return vec4<f32>(color * density, density);
}

fn wrapped(value: i32, size: i32) -> i32 {
    return ((value % size) + size) % size;
}

@compute @workgroup_size(4, 4, 4)
fn evolve(@builtin(global_invocation_id) gid: vec3<u32>) {
    let size_u = u32(u.volume_time.x);
    if (any(gid >= vec3<u32>(size_u))) { return; }
    let size_i = i32(size_u);
    let coord = vec3<i32>(gid);
    let uvw = (vec3<f32>(gid) + vec3<f32>(0.5)) / f32(size_u);
    let p = uvw * 2.0 - vec3<f32>(1.0);
    let time = u.volume_time.z;
    let delta = u.volume_time.w;
    let scene = u.flags.x;
    let clear_flag = u.flags.z;

    if (clear_flag > 0u) {
        textureStore(target_volume, coord, vec4<f32>(0.0));
        return;
    }

    let swirl = vec3<f32>(-p.z, 0.35 * sin(time + p.x * 4.0), p.x) * u.motion.y;
    let drift = vec3<f32>(sin(time * 0.37 + p.y * 3.0), cos(time * 0.29 + p.z * 2.0), sin(time * 0.43 + p.x * 2.0));
    let flow = (swirl + drift * 0.35) * u.motion.x;
    let offset = vec3<i32>(round(flow * delta * f32(size_u) * 0.18));
    let advected_coord = vec3<i32>(wrapped(coord.x - offset.x, size_i), wrapped(coord.y - offset.y, size_i), wrapped(coord.z - offset.z, size_i));

    let previous = textureLoad(source_volume, advected_coord, 0);
    let xp = textureLoad(source_volume, vec3<i32>(wrapped(coord.x + 1, size_i), coord.y, coord.z), 0);
    let xm = textureLoad(source_volume, vec3<i32>(wrapped(coord.x - 1, size_i), coord.y, coord.z), 0);
    let yp = textureLoad(source_volume, vec3<i32>(coord.x, wrapped(coord.y + 1, size_i), coord.z), 0);
    let ym = textureLoad(source_volume, vec3<i32>(coord.x, wrapped(coord.y - 1, size_i), coord.z), 0);
    let zp = textureLoad(source_volume, vec3<i32>(coord.x, coord.y, wrapped(coord.z + 1, size_i)), 0);
    let zm = textureLoad(source_volume, vec3<i32>(coord.x, coord.y, wrapped(coord.z - 1, size_i)), 0);
    let neighbor_average = (xp + xm + yp + ym + zp + zm) / 6.0;

    let source = scene_source(p, time, scene);
    let retention = pow(clamp(u.behavior.x, 0.0, 1.0), delta * 60.0);
    let diffusion = clamp(u.behavior.y * delta * 8.0, 0.0, 1.0);
    let mixed_value = mix(previous, neighbor_average, diffusion) * retention;
    let erosion = clamp(u.behavior.z * delta * 2.0, 0.0, 1.0);
    let next_alpha = max(0.0, mixed_value.a - erosion * max(0.0, mixed_value.a - neighbor_average.a));
    let color_scale = select(1.0, next_alpha / max(previous.a, 0.0001), previous.a > 0.0001);
    var evolved = vec4<f32>(mixed_value.rgb * color_scale, next_alpha);
    evolved = evolved + source * u.behavior.w * delta * 8.0;

    if (u.motion.w > 0.5) {
        let shell = exp(-90.0 * abs(length(p) - 0.56));
        evolved = evolved + vec4<f32>(palette(0.8, scene) * shell * 2.5, shell * 1.5);
    }

    evolved = clamp(evolved, vec4<f32>(0.0), vec4<f32>(16.0));
    textureStore(target_volume, coord, evolved);
}
