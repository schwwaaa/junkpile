struct Uniforms {
    resolution_time: vec4<f32>,
    simulation: vec4<f32>,
    render: vec4<f32>,
    counts: vec4<u32>,
};

struct Particle {
    position: vec2<f32>,
    velocity: vec2<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var<storage, read_write> particles: array<Particle>;

fn hash11(value: f32) -> f32 {
    return fract(sin(value * 127.1) * 43758.5453123);
}

fn safe_normalize(value: vec2<f32>) -> vec2<f32> {
    return value / max(length(value), 0.0001);
}

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let particle_index = global_id.x;
    if (particle_index >= u.counts.x) {
        return;
    }

    var particle = particles[particle_index];
    let aspect = max(u.resolution_time.x / max(u.resolution_time.y, 1.0), 0.25);
    let time = u.resolution_time.z;
    let delta = u.simulation.x * u.render.z;
    let field_strength = u.simulation.y;
    let turbulence = u.simulation.z;
    let drag = clamp(u.simulation.w, 0.80, 0.9995);
    let seed = f32(u.counts.w & 65535u);

    for (var step_index: u32 = 0u; step_index < 8u; step_index = step_index + 1u) {
        if (step_index >= u.counts.y) {
            break;
        }

        let field_position = vec2<f32>(particle.position.x * aspect, particle.position.y);
        let radial_direction = safe_normalize(field_position);
        let tangent_direction = vec2<f32>(-radial_direction.y, radial_direction.x);
        let radius_squared = max(dot(field_position, field_position), 0.025);

        let identity = f32(particle_index) * 0.000173 + seed * 0.0137;
        let noise_angle = hash11(identity + f32(step_index) * 1.719) * 6.2831853
            + time * (0.19 + hash11(identity + 5.3) * 0.31);
        let noise_direction = vec2<f32>(cos(noise_angle), sin(noise_angle));
        let wave = sin(field_position.x * 4.7 - field_position.y * 3.1 + time * 0.73 + identity);

        let orbit_force = tangent_direction * field_strength / (0.18 + radius_squared);
        let center_force = -radial_direction * (0.16 + radius_squared * 0.08);
        let noise_force = noise_direction * turbulence * (0.25 + 0.75 * abs(wave));
        let field_force = orbit_force + center_force + noise_force;
        let clip_force = vec2<f32>(field_force.x / aspect, field_force.y);

        let drag_factor = pow(drag, delta * 60.0);
        particle.velocity = particle.velocity * drag_factor + clip_force * delta;
        particle.position = particle.position + particle.velocity * delta;

        if (particle.position.x < -1.08) {
            particle.position.x = 1.08;
        } else if (particle.position.x > 1.08) {
            particle.position.x = -1.08;
        }
        if (particle.position.y < -1.08) {
            particle.position.y = 1.08;
        } else if (particle.position.y > 1.08) {
            particle.position.y = -1.08;
        }
    }

    particles[particle_index] = particle;
}
