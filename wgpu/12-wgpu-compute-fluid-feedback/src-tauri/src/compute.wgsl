struct Uniforms {
    grid_time: vec4<f32>,
    flow: vec4<f32>,
    emitter: vec4<f32>,
    motion: vec4<f32>,
    look: vec4<f32>,
    control: vec4<f32>,
    output: vec4<f32>,
    flags: vec4<u32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

@group(0) @binding(1)
var source_field: texture_2d<f32>;

@group(0) @binding(2)
var auxiliary_field: texture_2d<f32>;

@group(0) @binding(3)
var destination_field: texture_storage_2d<rgba16float, write>;

struct Injection {
    force: vec2<f32>,
    color: vec3<f32>,
    weight: f32,
};

fn field_dimensions() -> vec2<i32> {
    return vec2<i32>(textureDimensions(source_field, 0));
}

fn safe_coordinate(coordinate: vec2<i32>) -> vec2<i32> {
    let maximum = field_dimensions() - vec2<i32>(1);
    return clamp(coordinate, vec2<i32>(0), maximum);
}

fn load_source(coordinate: vec2<i32>) -> vec4<f32> {
    return textureLoad(source_field, safe_coordinate(coordinate), 0);
}

fn load_auxiliary(coordinate: vec2<i32>) -> vec4<f32> {
    return textureLoad(auxiliary_field, safe_coordinate(coordinate), 0);
}

fn sample_source_bilinear(pixel_position: vec2<f32>) -> vec4<f32> {
    let base_coordinate = vec2<i32>(floor(pixel_position));
    let interpolation = fract(pixel_position);
    let lower_left = load_source(base_coordinate);
    let lower_right = load_source(base_coordinate + vec2<i32>(1, 0));
    let upper_left = load_source(base_coordinate + vec2<i32>(0, 1));
    let upper_right = load_source(base_coordinate + vec2<i32>(1, 1));
    let lower = mix(lower_left, lower_right, interpolation.x);
    let upper = mix(upper_left, upper_right, interpolation.x);
    return mix(lower, upper, interpolation.y);
}

fn safe_normalize(value: vec2<f32>) -> vec2<f32> {
    let magnitude = length(value);
    if (magnitude < 0.000001) {
        return vec2<f32>(0.0);
    }
    return value / magnitude;
}

fn rotate_2d(value: vec2<f32>, angle: f32) -> vec2<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec2<f32>(
        cosine * value.x - sine * value.y,
        sine * value.x + cosine * value.y,
    );
}

fn hash_1d(value: f32) -> f32 {
    return fract(sin(value * 127.1 + 311.7) * 43758.5453);
}

fn palette_color(palette: u32, phase: f32) -> vec3<f32> {
    let wave = 0.5 + 0.5 * cos(6.2831853 * (vec3<f32>(phase) + vec3<f32>(0.0, 0.33, 0.67)));
    if (palette == 1u) {
        return vec3<f32>(1.25, 0.18, 0.025) * (0.65 + 0.55 * wave.r)
            + vec3<f32>(0.08, 0.01, 0.14) * wave.b;
    }
    if (palette == 2u) {
        return vec3<f32>(0.14, 1.30, 0.20) * (0.55 + 0.45 * wave.g)
            + vec3<f32>(0.55, 0.05, 1.10) * wave.b;
    }
    if (palette == 3u) {
        let luminance = 0.35 + 0.95 * wave.r;
        return vec3<f32>(luminance);
    }
    return vec3<f32>(0.05, 0.85, 1.35) * (0.55 + 0.45 * wave.b)
        + vec3<f32>(1.15, 0.08, 0.72) * wave.r;
}

fn gaussian_weight(offset: vec2<f32>, radius: f32) -> f32 {
    let safe_radius = max(radius, 0.001);
    return exp(-dot(offset, offset) / (safe_radius * safe_radius));
}

fn emitter_injection(uv: vec2<f32>) -> Injection {
    let elapsed = u.grid_time.z * max(u.motion.y, 0.0);
    let manual_center = clamp(u.motion.zw, vec2<f32>(0.02), vec2<f32>(0.98));
    let radius = max(u.emitter.y, 0.002);
    let force_strength = u.emitter.x * u.control.x;
    let dye_strength = u.emitter.z * u.control.x;
    let mode = u.flags.y;

    var result: Injection;
    result.force = vec2<f32>(0.0);
    result.color = palette_color(u.flags.z, elapsed * 0.07 + uv.x * 0.45 + uv.y * 0.25);
    result.weight = 0.0;

    if (mode == 0u) {
        let center = manual_center + vec2<f32>(cos(elapsed), sin(elapsed * 1.17)) * 0.22;
        let offset = uv - center;
        let weight = gaussian_weight(offset, radius);
        let tangent = safe_normalize(vec2<f32>(-offset.y, offset.x));
        let direction = safe_normalize(tangent * 0.82 + vec2<f32>(cos(elapsed * 1.31), sin(elapsed * 0.83)) * 0.48);
        result.force = direction * force_strength * weight;
        result.weight = weight * dye_strength;
        return result;
    }

    if (mode == 1u) {
        let separation = vec2<f32>(0.18 + 0.05 * sin(elapsed * 0.43), 0.0);
        let first_center = manual_center - separation;
        let second_center = manual_center + separation;
        let first_offset = uv - first_center;
        let second_offset = uv - second_center;
        let first_weight = gaussian_weight(first_offset, radius);
        let second_weight = gaussian_weight(second_offset, radius);
        let first_tangent = safe_normalize(vec2<f32>(-first_offset.y, first_offset.x));
        let second_tangent = safe_normalize(vec2<f32>(second_offset.y, -second_offset.x));
        result.force = (first_tangent * first_weight + second_tangent * second_weight)
            * force_strength;
        result.weight = (first_weight + second_weight) * dye_strength;
        result.color = palette_color(u.flags.z, elapsed * 0.11 + uv.x * 0.9);
        return result;
    }

    if (mode == 2u) {
        let column_count = 7.0;
        let column = floor(uv.x * column_count);
        let column_center = (column + 0.5) / column_count
            + (hash_1d(column + floor(elapsed * 0.17)) - 0.5) * 0.06;
        let fall_phase = fract(elapsed * 0.11 + hash_1d(column * 3.7));
        let center = vec2<f32>(column_center, 1.08 - fall_phase * 1.16);
        let offset = uv - center;
        let weight = gaussian_weight(offset, radius * 0.72);
        result.force = vec2<f32>(0.10 * sin(elapsed + column), -1.0)
            * force_strength * weight;
        result.weight = weight * dye_strength;
        result.color = palette_color(u.flags.z, column / column_count + elapsed * 0.03);
        return result;
    }

    let lattice = fract(uv * 4.0 + vec2<f32>(elapsed * 0.025, -elapsed * 0.018)) - vec2<f32>(0.5);
    let weight = gaussian_weight(lattice / 4.0, radius * 0.72);
    let tangent = safe_normalize(vec2<f32>(-lattice.y, lattice.x));
    result.force = tangent * force_strength * weight;
    result.weight = weight * dye_strength * 0.42;
    result.color = palette_color(u.flags.z, uv.x * 1.7 - uv.y * 1.3 + elapsed * 0.05);
    return result;
}

fn valid_invocation(global_id: vec3<u32>) -> bool {
    let dimensions = textureDimensions(destination_field);
    return global_id.x < dimensions.x && global_id.y < dimensions.y;
}

@compute @workgroup_size(8, 8, 1)
fn advect_velocity(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }

    let coordinate = vec2<i32>(global_id.xy);
    let dimensions = vec2<f32>(textureDimensions(source_field, 0));
    let pixel_center = vec2<f32>(coordinate) + vec2<f32>(0.5);
    let uv = pixel_center / dimensions;
    let delta = max(u.grid_time.w, 0.0);
    let current_velocity = load_source(coordinate).xy;
    let back_position = pixel_center - current_velocity * delta * dimensions;
    var next_velocity = sample_source_bilinear(back_position - vec2<f32>(0.5)).xy;

    let left_velocity = load_source(coordinate + vec2<i32>(-1, 0)).xy;
    let right_velocity = load_source(coordinate + vec2<i32>(1, 0)).xy;
    let lower_velocity = load_source(coordinate + vec2<i32>(0, -1)).xy;
    let upper_velocity = load_source(coordinate + vec2<i32>(0, 1)).xy;
    let neighbor_average = (left_velocity + right_velocity + lower_velocity + upper_velocity) * 0.25;
    let diffusion_amount = clamp(u.flow.z * delta * 60.0, 0.0, 0.45);
    next_velocity = mix(next_velocity, neighbor_average, diffusion_amount);

    let injection = emitter_injection(uv);
    next_velocity += injection.force * delta;
    next_velocity *= pow(clamp(u.flow.x, 0.0, 1.0), delta * 60.0);

    let velocity_magnitude = length(next_velocity);
    if (velocity_magnitude > 2.5) {
        next_velocity *= 2.5 / velocity_magnitude;
    }

    textureStore(destination_field, coordinate, vec4<f32>(next_velocity, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn calculate_curl(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }
    let coordinate = vec2<i32>(global_id.xy);
    let left_velocity = load_source(coordinate + vec2<i32>(-1, 0)).xy;
    let right_velocity = load_source(coordinate + vec2<i32>(1, 0)).xy;
    let lower_velocity = load_source(coordinate + vec2<i32>(0, -1)).xy;
    let upper_velocity = load_source(coordinate + vec2<i32>(0, 1)).xy;
    let curl_value = 0.5 * (
        right_velocity.y - left_velocity.y
        - upper_velocity.x + lower_velocity.x
    );
    textureStore(destination_field, coordinate, vec4<f32>(curl_value, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn apply_vorticity(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }
    let coordinate = vec2<i32>(global_id.xy);
    let left_curl = abs(load_auxiliary(coordinate + vec2<i32>(-1, 0)).x);
    let right_curl = abs(load_auxiliary(coordinate + vec2<i32>(1, 0)).x);
    let lower_curl = abs(load_auxiliary(coordinate + vec2<i32>(0, -1)).x);
    let upper_curl = abs(load_auxiliary(coordinate + vec2<i32>(0, 1)).x);
    let center_curl = load_auxiliary(coordinate).x;
    let gradient = vec2<f32>(right_curl - left_curl, upper_curl - lower_curl) * 0.5;
    let direction = safe_normalize(gradient);
    let confinement = vec2<f32>(direction.y, -direction.x)
        * center_curl * u.flow.w;
    let current_velocity = load_source(coordinate).xy;
    let next_velocity = current_velocity + confinement * max(u.grid_time.w, 0.0);
    textureStore(destination_field, coordinate, vec4<f32>(next_velocity, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn calculate_divergence(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }
    let coordinate = vec2<i32>(global_id.xy);
    let left_velocity = load_source(coordinate + vec2<i32>(-1, 0)).xy;
    let right_velocity = load_source(coordinate + vec2<i32>(1, 0)).xy;
    let lower_velocity = load_source(coordinate + vec2<i32>(0, -1)).xy;
    let upper_velocity = load_source(coordinate + vec2<i32>(0, 1)).xy;
    let divergence = 0.5 * (
        right_velocity.x - left_velocity.x
        + upper_velocity.y - lower_velocity.y
    );
    textureStore(destination_field, coordinate, vec4<f32>(divergence, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn solve_pressure(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }
    let coordinate = vec2<i32>(global_id.xy);
    let left_pressure = load_source(coordinate + vec2<i32>(-1, 0)).x;
    let right_pressure = load_source(coordinate + vec2<i32>(1, 0)).x;
    let lower_pressure = load_source(coordinate + vec2<i32>(0, -1)).x;
    let upper_pressure = load_source(coordinate + vec2<i32>(0, 1)).x;
    let divergence = load_auxiliary(coordinate).x;
    let pressure = (left_pressure + right_pressure + lower_pressure + upper_pressure - divergence) * 0.25;
    textureStore(destination_field, coordinate, vec4<f32>(pressure, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn subtract_pressure_gradient(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }
    let coordinate = vec2<i32>(global_id.xy);
    let left_pressure = load_auxiliary(coordinate + vec2<i32>(-1, 0)).x;
    let right_pressure = load_auxiliary(coordinate + vec2<i32>(1, 0)).x;
    let lower_pressure = load_auxiliary(coordinate + vec2<i32>(0, -1)).x;
    let upper_pressure = load_auxiliary(coordinate + vec2<i32>(0, 1)).x;
    let gradient = vec2<f32>(right_pressure - left_pressure, upper_pressure - lower_pressure) * 0.5;
    var next_velocity = load_source(coordinate).xy - gradient;
    let velocity_magnitude = length(next_velocity);
    if (velocity_magnitude > 2.5) {
        next_velocity *= 2.5 / velocity_magnitude;
    }
    textureStore(destination_field, coordinate, vec4<f32>(next_velocity, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn advect_dye(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (!valid_invocation(global_id)) {
        return;
    }

    let coordinate = vec2<i32>(global_id.xy);
    let dimensions = vec2<f32>(textureDimensions(source_field, 0));
    let pixel_center = vec2<f32>(coordinate) + vec2<f32>(0.5);
    let uv = pixel_center / dimensions;
    let delta = max(u.grid_time.w, 0.0);
    let velocity = load_auxiliary(coordinate).xy;
    let back_position = pixel_center - velocity * delta * dimensions;
    var next_color = sample_source_bilinear(back_position - vec2<f32>(0.5)).rgb;
    next_color *= pow(clamp(u.flow.y, 0.0, 1.0), delta * 60.0);

    let feedback_strength = clamp(u.emitter.w, 0.0, 1.0);
    if (feedback_strength > 0.0001) {
        let centered = uv - vec2<f32>(0.5);
        let feedback_uv = rotate_2d(centered, 0.0025 * feedback_strength)
            * (1.0 - 0.0018 * feedback_strength)
            + vec2<f32>(0.5);
        let feedback_color = sample_source_bilinear(
            feedback_uv * dimensions - vec2<f32>(0.5)
        ).rgb;
        next_color = mix(
            next_color,
            max(next_color, feedback_color),
            feedback_strength * 0.16,
        );
    }

    let injection = emitter_injection(uv);
    next_color += injection.color * injection.weight * delta;
    next_color = clamp(next_color, vec3<f32>(0.0), vec3<f32>(16.0));
    textureStore(destination_field, coordinate, vec4<f32>(next_color, 1.0));
}
