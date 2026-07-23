struct SceneUniforms {
    resolution_tile_origin: vec4<f32>,
    tile_size_time_samples: vec4<f32>,
    camera: vec4<f32>,
    field_a: vec4<f32>,
    field_b: vec4<f32>,
    tone: vec4<f32>,
    reserved_a: vec4<f32>,
    reserved_b: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: SceneUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    return output;
}

fn rotate2(point: vec2<f32>, angle: f32) -> vec2<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec2<f32>(
        cosine * point.x - sine * point.y,
        sine * point.x + cosine * point.y,
    );
}

fn hash21(point: vec2<f32>) -> f32 {
    let p3 = fract(point.xyx * 0.1031);
    let mixed = p3 + vec3<f32>(dot(p3, p3.yzx + vec3<f32>(33.33)));
    return fract((mixed.x + mixed.y) * mixed.z);
}

fn palette(t: f32, hue: f32, saturation: f32) -> vec3<f32> {
    let phase = vec3<f32>(0.00, 0.33, 0.67) + vec3<f32>(hue);
    let color = vec3<f32>(0.54) + vec3<f32>(0.46) * cos(6.2831853 * (phase + vec3<f32>(t)));
    let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    return mix(vec3<f32>(luma), color, vec3<f32>(saturation));
}

fn shade(global_pixel: vec2<f32>) -> vec3<f32> {
    let full_resolution = max(u.resolution_tile_origin.xy, vec2<f32>(1.0));
    var p = (2.0 * global_pixel - full_resolution) / full_resolution.y;

    let zoom = u.camera.x;
    let rotation = u.camera.y;
    let warp = u.field_a.x;
    let fold = u.field_a.y;
    let density = u.field_a.z;
    let detail = u.field_a.w;
    let glow = u.field_b.x;
    let hue = u.field_b.y;
    let saturation = u.field_b.z;
    let background = u.field_b.w;
    let time = u.tile_size_time_samples.z;

    p = rotate2(p, rotation + time * 0.025);
    p *= zoom;
    let warp_phase = vec2<f32>(
        sin(p.y * 2.2 + time * 0.31),
        cos(p.x * 2.0 - time * 0.27),
    );
    p += warp_phase * warp * 0.14;

    var z = vec3<f32>(p, 0.34 + sin(time * 0.17) * 0.08);
    var color = vec3<f32>(0.0);
    var attenuation = 1.0;

    for (var index: u32 = 0u; index < 16u; index = index + 1u) {
        if (f32(index) >= detail) {
            break;
        }

        z = abs(z);
        let radius_squared = max(dot(z, z), 0.14);
        z = z / radius_squared - vec3<f32>(fold, fold * 0.82, fold * 0.63);
        let rotated_xy = rotate2(z.xy, 0.12 + rotation * 0.17 + f32(index) * 0.035);
        z = vec3<f32>(rotated_xy, z.z);
        let rotated_xz = rotate2(z.xz, -0.08 + time * 0.008 + f32(index) * 0.021);
        z = vec3<f32>(rotated_xz.x, z.y, rotated_xz.y);

        let radius = length(z);
        let shell = exp(-abs(radius - 1.08) * density);
        let ribbon = exp(-abs(z.y + sin(z.x * 2.35 + time * 0.22) * 0.18) * density * 0.72);
        let filament = exp(-abs(z.x * z.z) * density * 0.48);
        let intensity = (shell * 0.66 + ribbon * 0.25 + filament * 0.10) * attenuation;
        let color_phase = f32(index) * 0.071 + radius * 0.032 + time * 0.011;
        color += palette(color_phase, hue, saturation) * intensity;
        attenuation *= 0.825;
    }

    let radial = length(p);
    let central_glow = exp(-radial * (1.3 + density * 0.025)) * glow;
    color += palette(time * 0.018 + radial * 0.08, hue + 0.07, saturation) * central_glow;

    let star_cell = floor(global_pixel * 0.37);
    let star = pow(max(hash21(star_cell) - 0.985, 0.0) / 0.015, 7.0);
    color += palette(hash21(star_cell + vec2<f32>(17.0)), hue + 0.12, saturation) * star * (0.45 + glow * 0.15);

    let vignette = 1.0 - smoothstep(0.35, 1.35, length((2.0 * global_pixel - full_resolution) / full_resolution.y));
    color *= mix(1.0, max(vignette, 0.0), u.tone.z);
    color += vec3<f32>(background * (0.24 + 0.76 * max(vignette, 0.0)));

    color *= u.tone.x;
    color = (color - vec3<f32>(0.5)) * u.tone.y + vec3<f32>(0.5);
    color = vec3<f32>(1.0) - exp(-max(color, vec3<f32>(0.0)));

    let grain = (hash21(global_pixel + vec2<f32>(time * 13.0, -time * 7.0)) - 0.5) * u.tone.w;
    return clamp(color + vec3<f32>(grain), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let tile_origin = u.resolution_tile_origin.zw;
    let sample_count = u32(clamp(round(u.tile_size_time_samples.w), 1.0, 4.0));
    var accumulated = vec3<f32>(0.0);
    let offsets = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.375, 0.125),
        vec2<f32>(-0.125, 0.375),
        vec2<f32>(0.125, -0.375),
    );

    for (var sample_index: u32 = 0u; sample_index < 4u; sample_index = sample_index + 1u) {
        if (sample_index >= sample_count) {
            break;
        }
        let global_pixel = tile_origin + input.position.xy + offsets[sample_index];
        accumulated += shade(global_pixel);
    }

    return vec4<f32>(accumulated / f32(sample_count), 1.0);
}
