struct Uniforms {
    resolution_time: vec4<f32>,
    camera: vec4<f32>,
    march: vec4<f32>,
    shape: vec4<f32>,
    look: vec4<f32>,
    motion: vec4<f32>,
    post: vec4<f32>,
    window: vec4<f32>,
    flags: vec4<u32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var raymarch_texture: texture_2d<f32>;

@group(0) @binding(2)
var linear_sampler: sampler;

struct SceneSample {
    distance: f32,
    material: f32,
};

struct MarchResult {
    distance: f32,
    material: f32,
    glow: f32,
    hit: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(3.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn rotate_x(point: vec3<f32>, angle: f32) -> vec3<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec3<f32>(
        point.x,
        cosine * point.y - sine * point.z,
        sine * point.y + cosine * point.z,
    );
}

fn rotate_y(point: vec3<f32>, angle: f32) -> vec3<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec3<f32>(
        cosine * point.x + sine * point.z,
        point.y,
        -sine * point.x + cosine * point.z,
    );
}

fn rotate_z(point: vec3<f32>, angle: f32) -> vec3<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec3<f32>(
        cosine * point.x - sine * point.y,
        sine * point.x + cosine * point.y,
        point.z,
    );
}

fn sd_sphere(point: vec3<f32>, radius: f32) -> f32 {
    return length(point) - radius;
}

fn sd_box(point: vec3<f32>, half_extents: vec3<f32>) -> f32 {
    let offset = abs(point) - half_extents;
    return length(max(offset, vec3<f32>(0.0)))
        + min(max(offset.x, max(offset.y, offset.z)), 0.0);
}

fn sd_round_box(point: vec3<f32>, half_extents: vec3<f32>, radius: f32) -> f32 {
    return sd_box(point, half_extents) - radius;
}

fn sd_torus(point: vec3<f32>, radii: vec2<f32>) -> f32 {
    let ring = vec2<f32>(length(point.xz) - radii.x, point.y);
    return length(ring) - radii.y;
}

fn sd_capsule(point: vec3<f32>, start: vec3<f32>, end: vec3<f32>, radius: f32) -> f32 {
    let point_offset = point - start;
    let axis = end - start;
    let projection = clamp(dot(point_offset, axis) / max(dot(axis, axis), 0.0001), 0.0, 1.0);
    return length(point_offset - axis * projection) - radius;
}

fn smooth_union(first: f32, second: f32, radius: f32) -> f32 {
    let blend = clamp(0.5 + 0.5 * (second - first) / max(radius, 0.0001), 0.0, 1.0);
    return mix(second, first, blend) - radius * blend * (1.0 - blend);
}

fn repeat_axis(value: f32, spacing: f32) -> f32 {
    let safe_spacing = max(spacing, 0.0001);
    return value - floor(value / safe_spacing + 0.5) * safe_spacing;
}

fn sample_sculpture(point: vec3<f32>) -> SceneSample {
    let time = u.resolution_time.z;
    let scale = max(u.shape.x, 0.05);
    var local_point = point / scale;
    local_point = rotate_y(local_point, time * 0.12);
    local_point = rotate_x(local_point, sin(time * 0.17) * 0.24);
    local_point = rotate_y(local_point, local_point.y * u.shape.y + sin(time * 0.23) * 0.22);

    let deformation = sin(local_point.x * 4.7 + time * 0.71)
        * sin(local_point.y * 5.3 - time * 0.43)
        * sin(local_point.z * 4.1 + time * 0.37)
        * 0.055
        * u.shape.w;

    let sphere_distance = sd_sphere(local_point, 0.70) + deformation;
    let torus_point = rotate_x(local_point, 1.04 + sin(time * 0.21) * 0.22);
    let torus_distance = sd_torus(torus_point, vec2<f32>(0.54, 0.15));
    let box_point = rotate_z(local_point, time * 0.16);
    let box_distance = sd_round_box(box_point, vec3<f32>(0.38, 0.38, 0.38), 0.12);

    let blend_radius = 0.06 + u.shape.w * 0.18;
    var distance = smooth_union(sphere_distance, torus_distance, blend_radius);
    distance = smooth_union(distance, box_distance, blend_radius * 0.82);

    let cavity_center = vec3<f32>(
        sin(time * 0.31) * 0.16,
        cos(time * 0.27) * 0.11,
        sin(time * 0.19) * 0.13,
    );
    let cavity = sd_sphere(local_point - cavity_center, 0.27 + 0.08 * u.shape.w);
    distance = max(distance, -cavity);

    var material = 0.0;
    if (torus_distance < sphere_distance) {
        material = 1.0;
    }
    if (box_distance < min(sphere_distance, torus_distance)) {
        material = 2.0;
    }
    var output: SceneSample;
    output.distance = distance * scale;
    output.material = material;
    return output;
}

fn sample_tunnel(point: vec3<f32>) -> SceneSample {
    let time = u.resolution_time.z;
    var local_point = rotate_y(point / max(u.shape.x, 0.05), time * 0.08);
    local_point = rotate_z(local_point, local_point.z * u.shape.y * 0.38);

    let spacing = max(u.shape.z, 0.35);
    let repeated_z = repeat_axis(local_point.z, spacing);
    let radial = length(local_point.xy);
    let ring_radius = 0.69 + sin(local_point.z * 2.4 + time * 0.8) * 0.08 * u.shape.w;
    let ring_distance = length(vec2<f32>(radial - ring_radius, repeated_z)) - 0.065;

    let wall_radius = 0.91 + sin(local_point.z * 3.1 - time * 0.52) * 0.06;
    let wall_distance = abs(radial - wall_radius) - (0.025 + u.shape.w * 0.018);

    var spoke_point = local_point;
    spoke_point = rotate_z(spoke_point, floor(local_point.z / spacing + 0.5) * 0.71);
    let spoke_distance = sd_box(
        vec3<f32>(spoke_point.x, spoke_point.y, repeated_z),
        vec3<f32>(0.045, 0.78, 0.045),
    );

    var distance = min(ring_distance, min(wall_distance, spoke_distance));
    distance = max(distance, sd_sphere(local_point, 1.45));

    var material = 3.0;
    if (wall_distance < ring_distance) {
        material = 4.0;
    }
    if (spoke_distance < min(ring_distance, wall_distance)) {
        material = 5.0;
    }
    var output: SceneSample;
    output.distance = distance * max(u.shape.x, 0.05);
    output.material = material;
    return output;
}

fn sample_lattice(point: vec3<f32>) -> SceneSample {
    let time = u.resolution_time.z;
    let scale = max(u.shape.x, 0.05);
    let spacing = max(u.shape.z, 0.35);
    var local_point = rotate_y(point / scale, time * 0.09);
    local_point = rotate_x(local_point, sin(time * 0.13) * 0.36);

    let cell = vec3<f32>(
        repeat_axis(local_point.x, spacing),
        repeat_axis(local_point.y, spacing),
        repeat_axis(local_point.z, spacing),
    );
    let pulse = 0.5 + 0.5 * sin(time * 0.9 + dot(floor(local_point / spacing + vec3<f32>(0.5)), vec3<f32>(1.7, 2.3, 3.1)));
    let sphere_distance = sd_sphere(cell, 0.11 + 0.08 * pulse * u.shape.w);
    let box_point = rotate_y(cell, time * 0.31 + local_point.y * u.shape.y);
    let box_distance = sd_round_box(box_point, vec3<f32>(0.085), 0.025);
    var distance = smooth_union(sphere_distance, box_distance, 0.04 + 0.05 * u.shape.w);
    distance = max(distance, sd_sphere(local_point, 1.34));

    let material = select(6.0, 7.0, box_distance < sphere_distance);
    var output: SceneSample;
    output.distance = distance * scale;
    output.material = material;
    return output;
}

fn sample_organism(point: vec3<f32>) -> SceneSample {
    let time = u.resolution_time.z;
    let scale = max(u.shape.x, 0.05);
    var local_point = rotate_y(point / scale, time * 0.11);
    local_point = rotate_x(local_point, sin(time * 0.16) * 0.31);

    let center_a = vec3<f32>(sin(time * 0.43) * 0.24, cos(time * 0.31) * 0.18, sin(time * 0.27) * 0.20);
    let center_b = vec3<f32>(cos(time * 0.37) * -0.32, sin(time * 0.29) * 0.22, cos(time * 0.21) * 0.24);
    let center_c = vec3<f32>(sin(time * 0.19) * 0.18, cos(time * 0.41) * -0.30, sin(time * 0.33) * -0.27);

    let blob_a = sd_sphere(local_point - center_a, 0.47);
    let blob_b = sd_sphere(local_point - center_b, 0.41);
    let blob_c = sd_sphere(local_point - center_c, 0.36);
    let ligament = sd_capsule(local_point, center_a, center_b, 0.16 + u.shape.w * 0.08);

    let blend_radius = 0.12 + u.shape.w * 0.18;
    var distance = smooth_union(blob_a, blob_b, blend_radius);
    distance = smooth_union(distance, blob_c, blend_radius * 0.88);
    distance = smooth_union(distance, ligament, blend_radius * 0.72);

    let membrane = sin(local_point.x * 5.1 + time * 0.7)
        * sin(local_point.y * 4.3 - time * 0.5)
        * sin(local_point.z * 5.7 + time * 0.4)
        * 0.035
        * u.shape.y;
    distance += membrane;
    var output: SceneSample;
    output.distance = distance * scale;
    output.material = 8.0 + clamp(length(local_point), 0.0, 1.0);
    return output;
}

fn map_scene(point: vec3<f32>) -> SceneSample {
    if (u.flags.x == 1u) {
        return sample_tunnel(point);
    }
    if (u.flags.x == 2u) {
        return sample_lattice(point);
    }
    if (u.flags.x == 3u) {
        return sample_organism(point);
    }
    return sample_sculpture(point);
}

fn estimate_normal(point: vec3<f32>) -> vec3<f32> {
    let epsilon = max(u.march.z * 1.6, 0.0002);
    let direction_a = vec3<f32>(1.0, -1.0, -1.0);
    let direction_b = vec3<f32>(-1.0, -1.0, 1.0);
    let direction_c = vec3<f32>(-1.0, 1.0, -1.0);
    let direction_d = vec3<f32>(1.0, 1.0, 1.0);
    return normalize(
        direction_a * map_scene(point + direction_a * epsilon).distance
            + direction_b * map_scene(point + direction_b * epsilon).distance
            + direction_c * map_scene(point + direction_c * epsilon).distance
            + direction_d * map_scene(point + direction_d * epsilon).distance,
    );
}

fn ambient_occlusion(point: vec3<f32>, normal: vec3<f32>) -> f32 {
    var occlusion = 0.0;
    var weight = 1.0;
    for (var index: u32 = 0u; index < 6u; index = index + 1u) {
        let sample_distance = 0.025 + f32(index) * 0.075;
        let scene_distance = map_scene(point + normal * sample_distance).distance;
        occlusion += max(sample_distance - scene_distance, 0.0) * weight;
        weight *= 0.62;
    }
    return clamp(1.0 - occlusion * 2.4 * u.look.z, 0.0, 1.0);
}

fn soft_shadow(origin: vec3<f32>, direction: vec3<f32>) -> f32 {
    var visibility = 1.0;
    var travel = 0.025;
    for (var index: u32 = 0u; index < 64u; index = index + 1u) {
        let distance = map_scene(origin + direction * travel).distance;
        visibility = min(visibility, u.march.w * distance / max(travel, 0.001));
        if (distance < u.march.z || travel > 5.0) {
            break;
        }
        travel += clamp(distance, 0.012, 0.18);
    }
    return clamp(visibility, 0.0, 1.0);
}

fn march_ray(origin: vec3<f32>, direction: vec3<f32>) -> MarchResult {
    var travel = 0.0;
    var material = 0.0;
    var glow_accumulator = 0.0;
    var hit = 0.0;

    for (var index: u32 = 0u; index < 320u; index = index + 1u) {
        if (f32(index) >= u.march.x) {
            break;
        }
        let point = origin + direction * travel;
        let scene_sample = map_scene(point);
        material = scene_sample.material;
        let distance = scene_sample.distance;

        glow_accumulator += exp(-abs(distance) * 13.0)
            * (0.006 + 0.002 * travel)
            * u.look.y;

        let hit_threshold = u.march.z * (1.0 + travel * 0.08);
        if (distance < hit_threshold) {
            hit = 1.0;
            break;
        }
        travel += clamp(distance * 0.78, hit_threshold * 0.45, 0.34);
        if (travel > u.march.y) {
            break;
        }
    }

    var output: MarchResult;
    output.distance = travel;
    output.material = material;
    output.glow = glow_accumulator;
    output.hit = hit;
    return output;
}

fn palette(value: f32) -> vec3<f32> {
    let base = vec3<f32>(0.48, 0.48, 0.52);
    let amplitude = vec3<f32>(0.52, 0.50, 0.48);
    let frequency = vec3<f32>(1.0, 1.0, 1.0);
    let phase = vec3<f32>(0.02, 0.24, 0.51);
    return base + amplitude * cos(6.2831853 * (frequency * value + phase));
}

fn material_color(point: vec3<f32>, material: f32) -> vec3<f32> {
    let time = u.resolution_time.z;
    let phase = material * 0.117
        + point.y * 0.13
        + length(point.xz) * 0.08
        + time * 0.015;
    var color = palette(phase);
    if (u.flags.x == 1u) {
        color = mix(color, vec3<f32>(0.16, 0.55, 1.25), 0.38);
    } else if (u.flags.x == 2u) {
        color = mix(color, vec3<f32>(0.98, 0.34, 0.12), 0.30);
    } else if (u.flags.x == 3u) {
        color = mix(color, vec3<f32>(0.72, 0.11, 0.47), 0.34);
    }
    return max(color, vec3<f32>(0.0));
}

fn background_color(direction: vec3<f32>) -> vec3<f32> {
    let horizon = pow(clamp(1.0 - abs(direction.y), 0.0, 1.0), 4.0);
    let vertical = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    let low = vec3<f32>(0.006, 0.008, 0.018);
    let high = vec3<f32>(0.035, 0.065, 0.12);
    return mix(low, high, vertical) + horizon * vec3<f32>(0.035, 0.018, 0.055);
}

fn camera_position(yaw: f32, pitch: f32, distance: f32) -> vec3<f32> {
    let cosine_pitch = cos(pitch);
    return vec3<f32>(
        sin(yaw) * cosine_pitch,
        sin(pitch),
        cos(yaw) * cosine_pitch,
    ) * distance;
}

@fragment
fn fs_raymarch(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let screen = (2.0 * position.xy - resolution) / resolution.y;
    let animated_yaw = u.camera.x + u.resolution_time.z * u.motion.y;
    let origin = camera_position(animated_yaw, u.camera.y, u.camera.z);
    let forward = normalize(-origin);
    var reference_up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(forward.y) > 0.985) {
        reference_up = vec3<f32>(0.0, 0.0, 1.0);
    }
    let right = normalize(cross(forward, reference_up));
    let up = normalize(cross(right, forward));
    let focal_scale = tan(clamp(u.camera.w, 0.20, 2.60) * 0.5);
    let direction = normalize(
        forward + right * screen.x * focal_scale + up * screen.y * focal_scale,
    );

    let march_result = march_ray(origin, direction);
    let background = background_color(direction);
    var color = background + palette(direction.y * 0.1 + u.resolution_time.z * 0.006)
        * march_result.glow
        * 0.12;

    if (march_result.hit > 0.5) {
        let point = origin + direction * march_result.distance;
        let normal = estimate_normal(point);
        let light_direction = normalize(vec3<f32>(0.62, 0.78, 0.38));
        let half_direction = normalize(light_direction - direction);
        let diffuse = max(dot(normal, light_direction), 0.0);
        let specular = pow(max(dot(normal, half_direction), 0.0), 42.0);
        let rim = pow(1.0 - max(dot(normal, -direction), 0.0), 2.4);

        var shadow = 1.0;
        if (u.flags.y == 1u) {
            shadow = soft_shadow(point + normal * u.march.z * 4.0, light_direction);
        }
        var occlusion = 1.0;
        if (u.flags.z == 1u) {
            occlusion = ambient_occlusion(point, normal);
        }

        let base = material_color(point, march_result.material);
        let lighting = 0.10 * occlusion
            + diffuse * shadow * (0.72 + 0.28 * occlusion)
            + rim * 0.30;
        let surface = base * lighting
            + vec3<f32>(1.0, 0.78, 0.52) * specular * shadow * 1.5
            + base * march_result.glow * 0.32;
        let fog_visibility = exp(-u.look.x * march_result.distance * march_result.distance);
        color = mix(background, surface, fog_visibility);
    }

    color += palette(march_result.material * 0.13 + u.resolution_time.z * 0.01)
        * march_result.glow
        * 0.15;
    return vec4<f32>(max(color, vec3<f32>(0.0)), 1.0);
}

fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {
    let numerator = color * (2.51 * color + vec3<f32>(0.03));
    let denominator = color * (2.43 * color + vec3<f32>(0.59)) + vec3<f32>(0.14);
    return clamp(numerator / denominator, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn stable_hash(point: vec2<f32>) -> f32 {
    return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_present(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let window_size = max(u.window.xy, vec2<f32>(1.0));
    let internal_size = max(u.resolution_time.xy, vec2<f32>(1.0));
    let uv = position.xy / window_size;
    let centered = uv - vec2<f32>(0.5);
    let radial_direction = centered / max(length(centered), 0.0001);
    let chromatic_offset = radial_direction * u.post.y * 1.6 / window_size;

    let center_color = textureSample(raymarch_texture, linear_sampler, uv).rgb;
    var color = vec3<f32>(
        textureSample(raymarch_texture, linear_sampler, uv + chromatic_offset).r,
        center_color.g,
        textureSample(raymarch_texture, linear_sampler, uv - chromatic_offset).b,
    );

    let texel = 1.0 / internal_size;
    let bloom_radius = 1.5 + u.post.x * 4.0;
    let horizontal = vec2<f32>(texel.x * bloom_radius, 0.0);
    let vertical = vec2<f32>(0.0, texel.y * bloom_radius);
    let diagonal_a = vec2<f32>(texel.x, texel.y) * bloom_radius * 0.72;
    let diagonal_b = vec2<f32>(texel.x, -texel.y) * bloom_radius * 0.72;

    var blurred = center_color * 0.20;
    blurred += textureSample(raymarch_texture, linear_sampler, uv + horizontal).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv - horizontal).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv + vertical).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv - vertical).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv + diagonal_a).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv - diagonal_a).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv + diagonal_b).rgb * 0.10;
    blurred += textureSample(raymarch_texture, linear_sampler, uv - diagonal_b).rgb * 0.10;
    color += max(blurred - vec3<f32>(0.58), vec3<f32>(0.0)) * u.post.x;

    color *= u.look.w;
    color = aces_tonemap(color);
    let vignette_shape = clamp(1.0 - dot(centered, centered) * 1.85, 0.0, 1.0);
    color *= mix(1.0, pow(vignette_shape, 0.72), u.post.z);

    let dither = (stable_hash(floor(position.xy)) - 0.5) / 255.0;
    color = pow(max(color + vec3<f32>(dither), vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
    return vec4<f32>(color, 1.0);
}
