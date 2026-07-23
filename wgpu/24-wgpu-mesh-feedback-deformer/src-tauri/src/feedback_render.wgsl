struct VertexState {
    position_u: vec4<f32>,
    velocity_v: vec4<f32>,
    normal_displacement: vec4<f32>,
    rest_seed: vec4<f32>,
};

fn safe_normalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
    let magnitude_squared = dot(value, value);
    if magnitude_squared > 0.0000001 {
        return value * inverseSqrt(magnitude_squared);
    }
    return fallback;
}

struct SceneUniforms {
    view_projection: mat4x4<f32>,
    model: mat4x4<f32>,
    camera_position: vec4<f32>,
    light_direction_intensity: vec4<f32>,
    render_params: vec4<f32>,
    base_color: vec4<f32>,
    accent_color: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> scene: SceneUniforms;

@group(0) @binding(1)
var<storage, read> render_states: array<VertexState>;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) velocity: f32,
    @location(4) displacement: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    let state = render_states[vertex_index];
    let world_position4 = scene.model * vec4<f32>(state.position_u.xyz, 1.0);
    var output: VertexOutput;
    output.clip_position = scene.view_projection * world_position4;
    output.world_position = world_position4.xyz;
    output.world_normal = safe_normalize((scene.model * vec4<f32>(state.normal_displacement.xyz, 0.0)).xyz, vec3<f32>(0.0, 1.0, 0.0));
    output.uv = vec2<f32>(state.position_u.w, state.velocity_v.w);
    output.velocity = length(state.velocity_v.xyz);
    output.displacement = state.normal_displacement.w;
    return output;
}

fn heat_palette(value: f32) -> vec3<f32> {
    let cold = vec3<f32>(0.02, 0.24, 0.70);
    let middle = vec3<f32>(0.10, 0.95, 0.72);
    let hot = vec3<f32>(1.00, 0.24, 0.06);
    if value < 0.5 {
        return mix(cold, middle, value * 2.0);
    }
    return mix(middle, hot, (value - 0.5) * 2.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let view_mode = scene.render_params.z;
    let normal = safe_normalize(input.world_normal, vec3<f32>(0.0, 1.0, 0.0));

    if view_mode > 0.5 && view_mode < 1.5 {
        return vec4<f32>(normal * 0.5 + vec3<f32>(0.5), 1.0);
    }
    if view_mode > 1.5 && view_mode < 2.5 {
        return vec4<f32>(heat_palette(clamp(input.velocity * 2.4, 0.0, 1.0)), 1.0);
    }
    if view_mode > 2.5 && view_mode < 3.5 {
        return vec4<f32>(heat_palette(clamp(input.displacement * 1.15, 0.0, 1.0)), 1.0);
    }
    if view_mode > 3.5 {
        let line_u = 1.0 - smoothstep(0.0, 0.035, abs(fract(input.uv.x * 32.0) - 0.5));
        let line_v = 1.0 - smoothstep(0.0, 0.035, abs(fract(input.uv.y * 20.0) - 0.5));
        let grid = clamp(line_u + line_v, 0.0, 1.0);
        return vec4<f32>(mix(scene.base_color.rgb * 0.12, vec3<f32>(0.95), grid), 1.0);
    }

    let displacement_mix = clamp(input.displacement * 0.85, 0.0, 1.0);
    let velocity_mix = clamp(input.velocity * 1.8, 0.0, 1.0);
    var base = mix(scene.base_color.rgb, scene.accent_color.rgb, displacement_mix);
    base = mix(base, vec3<f32>(1.0, 0.34, 0.08), velocity_mix * 0.28);
    base *= 0.93 + 0.07 * sin((input.uv.x * 13.0 + input.uv.y * 7.0 + scene.render_params.w * 0.08) * 6.2831853);

    let light_direction = normalize(-scene.light_direction_intensity.xyz);
    let light_intensity = scene.light_direction_intensity.w;
    let view_direction = normalize(scene.camera_position.xyz - input.world_position);
    let half_direction = normalize(light_direction + view_direction);
    let diffuse = max(dot(normal, light_direction), 0.0);
    let roughness = clamp(scene.render_params.y, 0.02, 1.0);
    let specular_power = mix(160.0, 8.0, roughness);
    let specular = pow(max(dot(normal, half_direction), 0.0), specular_power);
    let rim = pow(1.0 - max(dot(normal, view_direction), 0.0), 1.8);

    let energy = base * 0.09
        + base * diffuse * light_intensity
        + vec3<f32>(1.0, 0.94, 0.82) * specular * light_intensity * 0.72
        + scene.accent_color.rgb * rim * 0.28;
    let exposure = max(scene.render_params.x, 0.01);
    let mapped = vec3<f32>(1.0) - exp(-energy * exposure);
    return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
