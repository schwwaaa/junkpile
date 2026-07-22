struct SceneUniforms {
    view_projection: mat4x4<f32>,
    model: mat4x4<f32>,
    camera_position: vec4<f32>,
    light_direction_intensity: vec4<f32>,
    render_params: vec4<f32>,
    scene_params: vec4<f32>,
};

struct MaterialUniforms {
    base_color: vec4<f32>,
    material_params: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> scene: SceneUniforms;

@group(1) @binding(0)
var<uniform> material_data: MaterialUniforms;

@group(1) @binding(1)
var base_color_texture: texture_2d<f32>;

@group(1) @binding(2)
var base_color_sampler: sampler;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let world_position_4 = scene.model * vec4<f32>(input.position, 1.0);
    output.clip_position = scene.view_projection * world_position_4;
    output.world_position = world_position_4.xyz;
    output.world_normal = normalize((scene.model * vec4<f32>(input.normal, 0.0)).xyz);
    output.uv = input.uv;
    return output;
}

fn material_identifier(index_value: f32) -> vec3<f32> {
    let phase = index_value * 2.39996323;
    return 0.5 + 0.5 * cos(vec3<f32>(phase, phase + 2.094, phase + 4.188));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let sampled = textureSample(base_color_texture, base_color_sampler, input.uv);
    let base_color = material_data.base_color * sampled;
    if (base_color.a < 0.03) {
        discard;
    }

    let normal = normalize(input.world_normal);
    let light_direction = normalize(-scene.light_direction_intensity.xyz);
    let view_direction = normalize(scene.camera_position.xyz - input.world_position);
    let half_direction = normalize(light_direction + view_direction);
    let diffuse = max(dot(normal, light_direction), 0.0);
    let roughness = clamp(material_data.material_params.y, 0.04, 1.0);
    let metallic = clamp(material_data.material_params.x, 0.0, 1.0);
    let specular_power = mix(96.0, 8.0, roughness);
    let specular = pow(max(dot(normal, half_direction), 0.0), specular_power);
    let dielectric_specular = vec3<f32>(0.04);
    let specular_color = mix(dielectric_specular, base_color.rgb, metallic);
    let direct = base_color.rgb * (0.15 + diffuse * scene.light_direction_intensity.w);
    let shaded = direct + specular_color * specular * scene.light_direction_intensity.w;

    let view_mode = i32(scene.render_params.y + 0.5);
    var color = shaded;
    if (view_mode == 1) {
        color = normal * 0.5 + 0.5;
    } else if (view_mode == 2) {
        color = vec3<f32>(fract(input.uv), 0.15);
    } else if (view_mode == 3) {
        color = material_identifier(material_data.material_params.z);
    }

    let exposure = max(scene.render_params.x, 0.01);
    color = vec3<f32>(1.0) - exp(-color * exposure);
    color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
    return vec4<f32>(color, 1.0);
}
