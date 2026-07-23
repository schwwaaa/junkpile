struct VertexState {
    position_u: vec4<f32>,
    velocity_v: vec4<f32>,
    normal_displacement: vec4<f32>,
    rest_seed: vec4<f32>,
};

struct ComputeUniforms {
    time_delta: vec4<f32>,
    forces: vec4<f32>,
    dynamics: vec4<f32>,
    field: vec4<f32>,
    impulse: vec4<f32>,
    topology: vec4<u32>,
};

@group(0) @binding(0)
var<uniform> simulation: ComputeUniforms;

@group(0) @binding(1)
var<storage, read> source_states: array<VertexState>;

@group(0) @binding(2)
var<storage, read_write> destination_states: array<VertexState>;

fn hash31(position: vec3<f32>) -> f32 {
    let cell = vec3<f32>(
        dot(position, vec3<f32>(127.1, 311.7, 74.7)),
        dot(position, vec3<f32>(269.5, 183.3, 246.1)),
        dot(position, vec3<f32>(113.5, 271.9, 124.6)),
    );
    return fract(sin(cell.x + sin(cell.y) + cell.z * 0.13) * 43758.5453);
}

fn value_noise(position: vec3<f32>) -> f32 {
    let cell = floor(position);
    let fraction = fract(position);
    let curve = fraction * fraction * (vec3<f32>(3.0) - 2.0 * fraction);

    let n000 = hash31(cell + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash31(cell + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash31(cell + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash31(cell + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash31(cell + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash31(cell + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash31(cell + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash31(cell + vec3<f32>(1.0, 1.0, 1.0));

    let nx00 = mix(n000, n100, curve.x);
    let nx10 = mix(n010, n110, curve.x);
    let nx01 = mix(n001, n101, curve.x);
    let nx11 = mix(n011, n111, curve.x);
    let nxy0 = mix(nx00, nx10, curve.y);
    let nxy1 = mix(nx01, nx11, curve.y);
    return mix(nxy0, nxy1, curve.z);
}

fn fbm(position: vec3<f32>) -> f32 {
    var point = position;
    var amplitude = 0.5;
    var total = 0.0;
    for (var octave = 0; octave < 4; octave = octave + 1) {
        total += value_noise(point) * amplitude;
        point = point * 2.03 + vec3<f32>(11.7, 7.3, 5.9);
        amplitude *= 0.5;
    }
    return total;
}

fn safe_normalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
    let magnitude_squared = dot(value, value);
    if magnitude_squared > 0.0000001 {
        return value * inverseSqrt(magnitude_squared);
    }
    return fallback;
}

fn canonical_x(x: u32, columns: u32) -> u32 {
    if x == columns - 1u {
        return 0u;
    }
    return x;
}

@compute @workgroup_size(128)
fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let vertex_count = simulation.topology.x;
    if index >= vertex_count {
        return;
    }

    let rows = max(simulation.topology.y, 2u);
    let columns = max(simulation.topology.z, 3u);
    let x = index % columns;
    let y = index / columns;
    let unique_columns = columns - 1u;
    let cx = canonical_x(x, columns);
    let left_x = (cx + unique_columns - 1u) % unique_columns;
    let right_x = (cx + 1u) % unique_columns;
    let up_y = max(y, 1u) - 1u;
    let down_y = min(y + 1u, rows - 1u);

    let left_index = y * columns + left_x;
    let right_index = y * columns + right_x;
    let up_index = up_y * columns + cx;
    let down_index = down_y * columns + cx;

    let state = source_states[index];
    let rest = state.rest_seed.xyz;
    let radial = safe_normalize(rest, vec3<f32>(0.0, 1.0, 0.0));
    var position = state.position_u.xyz;
    var velocity = state.velocity_v.xyz;

    let time = simulation.time_delta.x;
    let delta = clamp(simulation.time_delta.y * simulation.time_delta.z, 0.0, 0.0333333);
    let feedback = clamp(simulation.forces.x, 0.0, 1.025);
    let drive = simulation.forces.y;
    let noise_scale = simulation.forces.z;
    let noise_speed = simulation.forces.w;
    let damping = clamp(simulation.dynamics.x, 0.80, 1.0);
    let spring = simulation.dynamics.y;
    let smoothing = simulation.dynamics.z;
    let max_displacement = max(simulation.dynamics.w, 0.01);

    let animated_point = rest * noise_scale + vec3<f32>(
        time * noise_speed * 0.31,
        -time * noise_speed * 0.23,
        time * noise_speed * 0.19,
    );
    let noise_signal = fbm(animated_point) * 2.0 - 1.0;

    var tangent_a = cross(radial, vec3<f32>(0.0, 1.0, 0.0));
    if dot(tangent_a, tangent_a) < 0.0001 {
        tangent_a = cross(radial, vec3<f32>(1.0, 0.0, 0.0));
    }
    tangent_a = safe_normalize(tangent_a, vec3<f32>(1.0, 0.0, 0.0));
    let tangent_b = safe_normalize(cross(radial, tangent_a), vec3<f32>(0.0, 0.0, 1.0));
    let seed = state.rest_seed.w * 6.2831853;
    let curl_wave = tangent_a * sin(time * 1.17 + seed * 3.0 + rest.y * 4.0)
        + tangent_b * cos(time * 0.83 - seed * 2.0 + rest.x * 3.0);

    let neighbor_average = (
        source_states[left_index].position_u.xyz
        + source_states[right_index].position_u.xyz
        + source_states[up_index].position_u.xyz
        + source_states[down_index].position_u.xyz
    ) * 0.25;

    var force = radial * noise_signal * drive;
    force += (rest - position) * spring;
    force += (neighbor_average - position) * smoothing * 12.0;
    force += cross(vec3<f32>(0.0, 1.0, 0.0), position) * simulation.field.x * 0.42;
    force += curl_wave * simulation.field.y * 0.55;
    force += radial * sin(time * 2.1 + rest.y * 5.0 + seed) * simulation.field.z;
    force += vec3<f32>(0.0, simulation.field.w, 0.0);

    if simulation.impulse.z > 0.5 {
        let phase = simulation.impulse.w;
        let impulse_center = safe_normalize(vec3<f32>(
            sin(phase * 1.71 + 0.4),
            sin(phase * 0.93 + 1.7),
            cos(phase * 1.37 - 0.2),
        ), vec3<f32>(0.0, 1.0, 0.0));
        let surface_distance = distance(radial, impulse_center);
        let radius = max(simulation.impulse.y, 0.02);
        let falloff = 1.0 - smoothstep(radius * 0.22, radius, surface_distance);
        force += radial * simulation.impulse.x * falloff;
        force += tangent_a * simulation.impulse.x * falloff * 0.16;
    }

    velocity *= feedback;
    velocity *= pow(damping, delta * 60.0);
    velocity += force * delta;
    position += velocity * delta;

    var offset = position - rest;
    let offset_length = length(offset);
    if offset_length > max_displacement {
        offset *= max_displacement / max(offset_length, 0.00001);
        position = rest + offset;
        velocity *= 0.72;
    }

    let tangent_u = source_states[right_index].position_u.xyz - source_states[left_index].position_u.xyz;
    let tangent_v = source_states[down_index].position_u.xyz - source_states[up_index].position_u.xyz;
    var normal = safe_normalize(cross(tangent_u, tangent_v), radial);
    if dot(normal, radial) < 0.0 {
        normal = -normal;
    }
    normal = safe_normalize(mix(state.normal_displacement.xyz, normal, 0.55), radial);

    destination_states[index].position_u = vec4<f32>(position, state.position_u.w);
    destination_states[index].velocity_v = vec4<f32>(velocity, state.velocity_v.w);
    destination_states[index].normal_displacement = vec4<f32>(normal, length(position - rest));
    destination_states[index].rest_seed = state.rest_seed;
}
