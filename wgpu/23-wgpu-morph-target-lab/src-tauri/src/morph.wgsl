struct SceneUniforms {
    view_projection: mat4x4<f32>,
    model: mat4x4<f32>,
    camera_position: vec4<f32>,
    light_direction_intensity: vec4<f32>,
    morph_weights: vec4<f32>,
    render_params: vec4<f32>,
    animation_params: vec4<f32>,
    base_color: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> scene: SceneUniforms;

struct VertexInput {
    @location(0) base_position: vec3<f32>,
    @location(1) cube_position: vec3<f32>,
    @location(2) torus_position: vec3<f32>,
    @location(3) bloom_position: vec3<f32>,
    @location(4) base_normal: vec3<f32>,
    @location(5) cube_normal: vec3<f32>,
    @location(6) torus_normal: vec3<f32>,
    @location(7) bloom_normal: vec3<f32>,
    @location(8) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) morph_mix: vec3<f32>,
};

fn blend_target(
    base: vec3<f32>,
    cube: vec3<f32>,
    torus: vec3<f32>,
    bloom: vec3<f32>,
    weights: vec3<f32>,
    mode: f32,
) -> vec3<f32> {
    if mode < 0.5 {
        // Independent / additive shape keys.
        return base
            + (cube - base) * weights.x
            + (torus - base) * weights.y
            + (bloom - base) * weights.z;
    }

    if mode < 1.5 {
        // Normalized weighted blend. The base receives any unused weight.
        let base_weight = max(0.0, 1.0 - weights.x - weights.y - weights.z);
        let total = max(0.0001, base_weight + weights.x + weights.y + weights.z);
        return (
            base * base_weight
            + cube * weights.x
            + torus * weights.y
            + bloom * weights.z
        ) / total;
    }

    // Sequential crossfades make each slider behave as an ordered stage.
    var result = mix(base, cube, weights.x);
    result = mix(result, torus, weights.y);
    result = mix(result, bloom, weights.z);
    return result;
}

fn palette(weights: vec3<f32>, uv: vec2<f32>, time: f32) -> vec3<f32> {
    let sphere_color = scene.base_color.rgb;
    let cube_color = vec3<f32>(1.00, 0.24, 0.10);
    let torus_color = vec3<f32>(0.18, 0.92, 0.62);
    let bloom_color = vec3<f32>(0.86, 0.28, 1.00);
    let total = max(1.0, weights.x + weights.y + weights.z);
    var color = sphere_color;
    color += (cube_color - sphere_color) * weights.x / total;
    color += (torus_color - sphere_color) * weights.y / total;
    color += (bloom_color - sphere_color) * weights.z / total;
    let bands = 0.92 + 0.08 * sin((uv.x * 11.0 + uv.y * 7.0 + time * 0.18) * 6.2831853);
    return color * bands;
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    let weights = clamp(scene.morph_weights.xyz, vec3<f32>(0.0), vec3<f32>(1.0));
    let blend_mode = scene.render_params.z;
    let displacement_scale = scene.animation_params.z;

    let blended_position = blend_target(
        input.base_position,
        input.cube_position,
        input.torus_position,
        input.bloom_position,
        weights,
        blend_mode,
    );
    let position = input.base_position + (blended_position - input.base_position) * displacement_scale;

    let blended_normal = blend_target(
        input.base_normal,
        input.cube_normal,
        input.torus_normal,
        input.bloom_normal,
        weights,
        blend_mode,
    );

    let world_position4 = scene.model * vec4<f32>(position, 1.0);
    var output: VertexOutput;
    output.clip_position = scene.view_projection * world_position4;
    output.world_position = world_position4.xyz;
    output.world_normal = normalize((scene.model * vec4<f32>(blended_normal, 0.0)).xyz);
    output.uv = input.uv;
    output.morph_mix = weights;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let view_mode = scene.render_params.w;
    let normal = normalize(input.world_normal);

    if view_mode > 0.5 && view_mode < 1.5 {
        return vec4<f32>(normal * 0.5 + vec3<f32>(0.5), 1.0);
    }

    if view_mode > 1.5 && view_mode < 2.5 {
        let heat = clamp(input.morph_mix, vec3<f32>(0.0), vec3<f32>(1.0));
        return vec4<f32>(heat.x, heat.y, heat.z, 1.0);
    }

    if view_mode > 2.5 {
        let grid_u = 1.0 - smoothstep(0.0, 0.018, abs(fract(input.uv.x * 24.0) - 0.5));
        let grid_v = 1.0 - smoothstep(0.0, 0.018, abs(fract(input.uv.y * 16.0) - 0.5));
        let grid = clamp(grid_u + grid_v, 0.0, 1.0);
        let surface = palette(input.morph_mix, input.uv, scene.animation_params.x) * 0.22;
        return vec4<f32>(mix(surface, vec3<f32>(0.95), grid), 1.0);
    }

    let light_direction = normalize(-scene.light_direction_intensity.xyz);
    let light_intensity = scene.light_direction_intensity.w;
    let view_direction = normalize(scene.camera_position.xyz - input.world_position);
    let half_direction = normalize(light_direction + view_direction);

    let diffuse = max(dot(normal, light_direction), 0.0);
    let roughness = clamp(scene.render_params.y, 0.02, 1.0);
    let specular_power = mix(150.0, 8.0, roughness);
    let specular = pow(max(dot(normal, half_direction), 0.0), specular_power);
    let fresnel = pow(1.0 - max(dot(normal, view_direction), 0.0), 3.0);
    let rim = pow(1.0 - max(dot(normal, view_direction), 0.0), 1.7);

    let base = palette(input.morph_mix, input.uv, scene.animation_params.x);
    let ambient = base * 0.095;
    let direct = base * diffuse * light_intensity;
    let highlight = vec3<f32>(1.0, 0.92, 0.78) * specular * light_intensity * 0.72;
    let rim_light = vec3<f32>(0.28, 0.60, 1.0) * rim * 0.34;
    let energy = ambient + direct + highlight + rim_light + base * fresnel * 0.08;

    let exposure = max(scene.render_params.x, 0.01);
    let mapped = vec3<f32>(1.0) - exp(-energy * exposure);
    let gamma_corrected = pow(mapped, vec3<f32>(1.0 / 2.2));
    return vec4<f32>(gamma_corrected, 1.0);
}
