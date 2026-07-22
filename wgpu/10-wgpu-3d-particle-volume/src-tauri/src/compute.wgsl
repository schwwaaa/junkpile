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
var<storage, read_write> particles: array<Particle>;

fn hash11(value: f32) -> f32 {
    return fract(sin(value * 127.1) * 43758.5453123);
}

fn safe_normalize3(value: vec3<f32>) -> vec3<f32> {
    return value / max(length(value), 0.0001);
}

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let particle_index = global_id.x;
    if (particle_index >= u.counts.x) {
        return;
    }

    var particle = particles[particle_index];
    let time = u.resolution_time.z;
    let delta = u.simulation.x * u.render.z;
    let field_strength = u.simulation.y;
    let turbulence = u.simulation.z;
    let drag = clamp(u.simulation.w, 0.80, 0.9995);
    let z_force = u.volume.y;
    let seed = f32(u.counts.w & 65535u);

    for (var step_index: u32 = 0u; step_index < 8u; step_index = step_index + 1u) {
        if (step_index >= u.counts.y) {
            break;
        }

        let position = particle.position.xyz;
        let radial_direction = safe_normalize3(position);
        let radius_squared = max(dot(position, position), 0.025);

        let axis_y = vec3<f32>(0.0, 1.0, 0.0);
        let axis_x = vec3<f32>(1.0, 0.0, 0.0);
        let orbit_y = safe_normalize3(cross(axis_y, position));
        let orbit_x = safe_normalize3(cross(axis_x, position));

        let identity = f32(particle_index) * 0.000173
            + seed * 0.0137
            + particle.velocity.w * 0.071;
        let phase = particle.position.w;

        let noise_direction = safe_normalize3(vec3<f32>(
            sin(position.y * 4.3 + position.z * 2.1 + time * 0.71 + identity),
            sin(position.z * 3.7 - position.x * 2.8 - time * 0.53 + identity * 1.7),
            sin(position.x * 4.9 + position.y * 3.2 + time * 0.61 + identity * 2.3),
        ));

        let pulse = sin(position.x * 3.9 - position.y * 2.7 + position.z * 4.1 + time + phase);
        let orbit_force = orbit_y * field_strength / (0.22 + radius_squared);
        let depth_orbit = orbit_x * z_force * (0.18 + 0.42 * abs(pulse));
        let center_force = -radial_direction * (0.18 + radius_squared * 0.11);
        let noise_force = noise_direction * turbulence * (0.22 + 0.78 * abs(pulse));
        let wave_force = vec3<f32>(0.0, pulse * 0.10, pulse * z_force * 0.32);
        let field_force = orbit_force + depth_orbit + center_force + noise_force + wave_force;

        let drag_factor = pow(drag, delta * 60.0);
        let next_velocity = particle.velocity.xyz * drag_factor + field_force * delta;
        particle.velocity = vec4<f32>(next_velocity, particle.velocity.w);

        let next_position = particle.position.xyz + next_velocity * delta;
        particle.position = vec4<f32>(next_position, particle.position.w);

        let next_radius = length(next_position);
        if (next_radius > 1.16) {
            let direction = safe_normalize3(next_position);
            let wrapped_position = -direction
                * (0.82 + hash11(identity + time * 0.01) * 0.12);
            let wrapped_velocity = next_velocity * 0.55;
            particle.position = vec4<f32>(wrapped_position, particle.position.w);
            particle.velocity = vec4<f32>(wrapped_velocity, particle.velocity.w);
        }
    }

    particles[particle_index] = particle;
}
