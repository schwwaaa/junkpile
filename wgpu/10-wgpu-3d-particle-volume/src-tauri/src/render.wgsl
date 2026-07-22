struct Uniforms {
    resolution_time: vec4<f32>,
    simulation: vec4<f32>,
    render: vec4<f32>,
    camera: vec4<f32>,
    volume: vec4<f32>,
    counts: vec4<u32>,
};

struct Particle {
    position: vec4<f32>,
    velocity: vec4<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var<storage, read> particles: array<Particle>;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_position: vec2<f32>,
    @location(1) color: vec3<f32>,
    @location(2) view_depth: f32,
    @location(3) world_depth: f32,
};

fn camera_position(yaw: f32, pitch: f32, distance: f32) -> vec3<f32> {
    let cos_pitch = cos(pitch);
    return vec3<f32>(
        sin(yaw) * cos_pitch,
        sin(pitch),
        cos(yaw) * cos_pitch,
    ) * distance;
}

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );

    let particle = particles[instance_index];
    let corner = corners[vertex_index];
    let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
    let aspect = resolution.x / resolution.y;
    let animated_yaw = u.camera.x + u.resolution_time.z * u.volume.z;
    let camera_pos = camera_position(animated_yaw, u.camera.y, u.camera.z);
    let forward = normalize(-camera_pos);
    var reference_up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(forward.y) > 0.985) {
        reference_up = vec3<f32>(0.0, 0.0, 1.0);
    }
    let right = normalize(cross(forward, reference_up));
    let up = normalize(cross(right, forward));

    let world_position = vec3<f32>(
        particle.position.x,
        particle.position.y,
        particle.position.z * u.volume.x,
    );
    let relative = world_position - camera_pos;
    var view_position = vec3<f32>(
        dot(relative, right),
        dot(relative, up),
        dot(relative, forward),
    );

    let speed_energy = clamp(length(particle.velocity.xyz) * 1.8, 0.0, 1.0);
    let depth_energy = clamp(particle.position.z * 0.5 + 0.5, 0.0, 1.0);
    let world_size = max(u.render.x, 0.0005) * (0.78 + speed_energy * 0.36);
    let billboard_offset = corner * world_size;
    view_position = vec3<f32>(
        view_position.x + billboard_offset.x,
        view_position.y + billboard_offset.y,
        view_position.z,
    );

    let near_plane = 0.05;
    let far_plane = 40.0;
    let f = 1.0 / tan(clamp(u.camera.w, 0.20, 2.60) * 0.5);
    let safe_z = max(view_position.z, near_plane + 0.0001);

    var output: VertexOutput;
    if (view_position.z <= near_plane) {
        output.clip_position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    } else {
        output.clip_position = vec4<f32>(
            view_position.x * f / aspect,
            view_position.y * f,
            safe_z * far_plane / (far_plane - near_plane)
                - near_plane * far_plane / (far_plane - near_plane),
            safe_z,
        );
    }

    let near_color = vec3<f32>(1.0, 0.42, 0.18);
    let far_color = vec3<f32>(0.18, 0.52, 1.0);
    let depth_tint = mix(near_color, far_color, depth_energy);
    output.local_position = corner;
    output.color = mix(particle.color.rgb, depth_tint, 0.48) * (0.68 + speed_energy * 0.72);
    output.view_depth = safe_z;
    output.world_depth = particle.position.z;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let radius = length(input.local_position);
    let alpha = 1.0 - smoothstep(0.10, 1.0, radius);
    if (alpha < 0.018) {
        discard;
    }

    let core = 1.0 - smoothstep(0.0, 0.30, radius);
    let fog_distance = max(input.view_depth - 1.2, 0.0);
    let fog = exp(-max(u.render.w, 0.0) * fog_distance * fog_distance);
    let intensity = alpha * (0.34 + core * 1.62) * max(u.render.y, 0.0) * fog;
    return vec4<f32>(input.color * intensity, clamp(intensity, 0.0, 1.0));
}
