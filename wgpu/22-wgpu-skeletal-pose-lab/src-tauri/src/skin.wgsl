struct SceneUniforms {
    view_projection: mat4x4<f32>,
    camera_position: vec4<f32>,
    light_direction_intensity: vec4<f32>,
    render_params: vec4<f32>,
    scene_params: vec4<f32>,
};

struct MaterialUniforms {
    base_color: vec4<f32>,
    material_params: vec4<f32>,
};

struct ObjectUniforms {
    model: mat4x4<f32>,
    skin_params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var base_color_texture: texture_2d<f32>;
@group(1) @binding(2) var base_color_sampler: sampler;
@group(2) @binding(0) var<uniform> object_data: ObjectUniforms;
@group(2) @binding(1) var<storage, read> joint_matrices: array<mat4x4<f32>>;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) joints: vec4<u32>,
    @location(4) weights: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) selected_weight: f32,
    @location(4) joint_color: vec3<f32>,
};

fn identity_matrix() -> mat4x4<f32> {
    return mat4x4<f32>(
        vec4<f32>(1.0, 0.0, 0.0, 0.0),
        vec4<f32>(0.0, 1.0, 0.0, 0.0),
        vec4<f32>(0.0, 0.0, 1.0, 0.0),
        vec4<f32>(0.0, 0.0, 0.0, 1.0),
    );
}

fn joint_matrix(index: u32) -> mat4x4<f32> {
    let count = max(u32(object_data.skin_params.y), 1u);
    return joint_matrices[min(index, count - 1u)];
}

fn palette(index: u32) -> vec3<f32> {
    let selector = index % 6u;
    if (selector == 0u) { return vec3<f32>(1.0, 0.24, 0.08); }
    if (selector == 1u) { return vec3<f32>(0.12, 0.78, 1.0); }
    if (selector == 2u) { return vec3<f32>(0.7, 0.25, 1.0); }
    if (selector == 3u) { return vec3<f32>(0.2, 1.0, 0.55); }
    if (selector == 4u) { return vec3<f32>(1.0, 0.78, 0.12); }
    return vec3<f32>(1.0, 0.18, 0.65);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var skinning_matrix = identity_matrix();
    if (object_data.skin_params.x > 0.5) {
        skinning_matrix =
            joint_matrix(input.joints.x) * input.weights.x +
            joint_matrix(input.joints.y) * input.weights.y +
            joint_matrix(input.joints.z) * input.weights.z +
            joint_matrix(input.joints.w) * input.weights.w;
    }

    let local_to_world = object_data.model * skinning_matrix;
    let world_position4 = local_to_world * vec4<f32>(input.position, 1.0);
    let world_normal4 = local_to_world * vec4<f32>(input.normal, 0.0);

    var selected_weight = 0.0;
    let selected_joint = object_data.skin_params.z;
    if (selected_joint >= 0.0) {
        if (f32(input.joints.x) == selected_joint) { selected_weight += input.weights.x; }
        if (f32(input.joints.y) == selected_joint) { selected_weight += input.weights.y; }
        if (f32(input.joints.z) == selected_joint) { selected_weight += input.weights.z; }
        if (f32(input.joints.w) == selected_joint) { selected_weight += input.weights.w; }
    }

    var strongest_index = input.joints.x;
    var strongest_weight = input.weights.x;
    if (input.weights.y > strongest_weight) {
        strongest_index = input.joints.y;
        strongest_weight = input.weights.y;
    }
    if (input.weights.z > strongest_weight) {
        strongest_index = input.joints.z;
        strongest_weight = input.weights.z;
    }
    if (input.weights.w > strongest_weight) {
        strongest_index = input.joints.w;
    }

    var output: VertexOutput;
    output.clip_position = scene.view_projection * world_position4;
    output.world_position = world_position4.xyz;
    output.world_normal = normalize(world_normal4.xyz);
    output.uv = input.uv;
    output.selected_weight = selected_weight;
    output.joint_color = palette(strongest_index);
    return output;
}

fn weight_heat(value: f32) -> vec3<f32> {
    let cold = vec3<f32>(0.02, 0.06, 0.18);
    let middle = vec3<f32>(0.05, 0.75, 1.0);
    let hot = vec3<f32>(1.0, 0.16, 0.02);
    if (value < 0.5) {
        return mix(cold, middle, value * 2.0);
    }
    return mix(middle, hot, (value - 0.5) * 2.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let view_mode = scene.render_params.y;
    if (view_mode > 2.5) {
        return vec4<f32>(input.world_normal * 0.5 + 0.5, 1.0);
    }
    if (view_mode > 1.5) {
        return vec4<f32>(input.joint_color, 1.0);
    }
    if (view_mode > 0.5) {
        return vec4<f32>(weight_heat(input.selected_weight), 1.0);
    }

    let sampled = textureSample(base_color_texture, base_color_sampler, input.uv);
    let texture_enabled = material.material_params.w;
    let base_color = material.base_color.rgb * mix(vec3<f32>(1.0), sampled.rgb, texture_enabled);
    let normal = normalize(input.world_normal);
    let light_direction = normalize(-scene.light_direction_intensity.xyz);
    let view_direction = normalize(scene.camera_position.xyz - input.world_position);
    let half_direction = normalize(light_direction + view_direction);
    let diffuse = max(dot(normal, light_direction), 0.0);
    let roughness = clamp(material.material_params.y, 0.04, 1.0);
    let metallic = clamp(material.material_params.x, 0.0, 1.0);
    let specular_power = mix(96.0, 5.0, roughness);
    let specular = pow(max(dot(normal, half_direction), 0.0), specular_power);
    let ambient = 0.13 + 0.08 * max(normal.y, 0.0);
    let lit = base_color * (ambient + diffuse * scene.light_direction_intensity.w)
        + mix(vec3<f32>(0.04), base_color, metallic) * specular * scene.light_direction_intensity.w;
    let mapped = vec3<f32>(1.0) - exp(-lit * scene.render_params.x);
    let gamma_corrected = pow(max(mapped, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
    return vec4<f32>(gamma_corrected, material.base_color.a * sampled.a);
}

struct BoneInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec3<f32>,
};

struct BoneOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs_bone(input: BoneInput) -> BoneOutput {
    var output: BoneOutput;
    output.clip_position = scene.view_projection * vec4<f32>(input.position, 1.0);
    output.color = input.color;
    return output;
}

@fragment
fn fs_bone(input: BoneOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.color, 0.95);
}
