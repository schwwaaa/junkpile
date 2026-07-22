struct Uniforms {
    resolution_time: vec4<f32>,
    source_dimensions: vec4<f32>,
    source_state: vec4<f32>,
    controls0: vec4<f32>,
    controls1: vec4<f32>,
    audio0: vec4<f32>,
    input0: vec4<f32>,
    network0: vec4<f32>,
};

struct GesturePoint {
    position_velocity: vec4<f32>,
    pressure_age_tool_active: vec4<f32>,
};

struct GestureData {
    points: array<GesturePoint, 64>,
};

struct SignalData {
    values: array<f32, 160>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> gestures: GestureData;
@group(0) @binding(2) var<storage, read> signals: SignalData;

@group(1) @binding(0) var camera_texture: texture_2d<f32>;
@group(1) @binding(1) var video_texture: texture_2d<f32>;
@group(1) @binding(2) var source_sampler: sampler;

@group(2) @binding(0) var composite_texture: texture_2d<f32>;
@group(2) @binding(1) var previous_feedback: texture_2d<f32>;
@group(2) @binding(2) var feedback_sampler: sampler;

@group(3) @binding(0) var final_texture: texture_2d<f32>;
@group(3) @binding(1) var final_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(3.0, 1.0)
    );
    var texcoords = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 2.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(2.0, 0.0)
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    output.uv = texcoords[vertex_index];
    return output;
}

fn fitted_uv(uv: vec2<f32>, source_size: vec2<f32>) -> vec2<f32> {
    let viewport_aspect = u.resolution_time.x / max(u.resolution_time.y, 1.0);
    let source_aspect = source_size.x / max(source_size.y, 1.0);
    var result = uv;
    if (source_aspect > viewport_aspect) {
        result.x = (uv.x - 0.5) * (viewport_aspect / source_aspect) + 0.5;
    } else {
        result.y = (uv.y - 0.5) * (source_aspect / viewport_aspect) + 0.5;
    }
    return result;
}

fn gesture_field(uv: vec2<f32>) -> vec3<f32> {
    var field_direction = vec2<f32>(0.0);
    var field_strength = 0.0;
    let gesture_count = min(u32(u.input0.z), 64u);
    for (var index: u32 = 0u; index < gesture_count; index = index + 1u) {
        let point_data = gestures.points[index];
        let point_position = point_data.position_velocity.xy;
        let point_velocity = point_data.position_velocity.zw;
        let pressure = point_data.pressure_age_tool_active.x;
        let point_age = point_data.pressure_age_tool_active.y;
        let tool = point_data.pressure_age_tool_active.z;
        let active_state = point_data.pressure_age_tool_active.w;
        let delta = uv - point_position;
        let distance_squared = dot(delta, delta) + 0.0004;
        let influence = exp(-distance_squared * 85.0) * (0.25 + pressure) * exp(-point_age * 1.8);
        let tangent = vec2<f32>(-delta.y, delta.x);
        var direction = -delta / sqrt(distance_squared);
        if (tool > 0.5 && tool < 1.5) {
            direction = delta / sqrt(distance_squared);
        } else if (tool >= 1.5 && tool < 2.5) {
            direction = tangent / sqrt(distance_squared);
        } else if (tool >= 2.5) {
            direction = vec2<f32>(0.0);
        }
        let velocity_boost = point_velocity * 0.06;
        field_direction = field_direction + (direction + velocity_boost) * influence * (0.35 + active_state * 0.65);
        field_strength = field_strength + influence;
    }
    return vec3<f32>(field_direction, field_strength);
}

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs_composite(input: VertexOutput) -> @location(0) vec4<f32> {
    let gesture = gesture_field(input.uv);
    let audio_energy = clamp((u.audio0.x * 0.8 + u.audio0.y * 1.4 + u.audio0.w) * u.controls1.z, 0.0, 3.0);
    let note_index = min(u32(clamp(input.uv.x, 0.0, 0.9999) * 128.0), 127u);
    let osc_index = 128u + min(u32(clamp(input.uv.y, 0.0, 0.9999) * 32.0), 31u);
    let note_energy = signals.values[note_index];
    let osc_energy = signals.values[osc_index];

    let wave = sin(input.uv.y * 34.0 + u.resolution_time.z * (1.0 + u.audio0.z * 3.0)) * audio_energy * 0.012;
    let displacement = u.controls0.z * (gesture.xy * u.controls1.w + vec2<f32>(wave + osc_energy * 0.01, note_energy * 0.012));
    let chroma_offset = vec2<f32>(u.controls0.w * (1.0 + audio_energy), 0.0);

    let camera_uv = fitted_uv(input.uv + displacement, u.source_dimensions.xy);
    let video_uv = fitted_uv(input.uv - displacement * 0.65, u.source_dimensions.zw);

    let camera_center = textureSample(camera_texture, source_sampler, camera_uv).rgb;
    let camera_red = textureSample(camera_texture, source_sampler, camera_uv + chroma_offset).r;
    let camera_blue = textureSample(camera_texture, source_sampler, camera_uv - chroma_offset).b;
    let camera_color = vec3<f32>(camera_red, camera_center.g, camera_blue);

    let video_center = textureSample(video_texture, source_sampler, video_uv).rgb;
    let video_red = textureSample(video_texture, source_sampler, video_uv - chroma_offset).r;
    let video_blue = textureSample(video_texture, source_sampler, video_uv + chroma_offset).b;
    let video_color = vec3<f32>(video_red, video_center.g, video_blue);

    let source_mix = clamp(u.controls0.x, 0.0, 1.0);
    let mode = u32(u.input0.w + 0.5);
    var combined = mix(camera_color, video_color, source_mix);
    if (mode == 1u) {
        combined = abs(camera_color - video_color);
    } else if (mode == 2u) {
        combined = camera_color * video_color * 1.8;
    } else if (mode == 3u) {
        let key = smoothstep(0.28, 0.62, luma(video_color));
        combined = mix(camera_color, video_color, key * source_mix);
    }

    let hue_phase = (u.network0.x + u.network0.y) * 3.14159265;
    let hue_tint = vec3<f32>(
        0.5 + 0.5 * sin(hue_phase),
        0.5 + 0.5 * sin(hue_phase + 2.094),
        0.5 + 0.5 * sin(hue_phase + 4.188)
    );
    let midi_tint = hue_tint * note_energy * 1.15;
    let osc_tint = vec3<f32>(osc_energy * 0.25, osc_energy * 0.8, osc_energy * 1.2);
    combined = combined + midi_tint + osc_tint + gesture.z * vec3<f32>(0.35, 0.6, 1.0);
    combined = combined * (0.85 + audio_energy * 0.45 + u.input0.x * 0.3 + u.input0.y * 0.3);
    return vec4<f32>(combined, 1.0);
}

@fragment
fn fs_feedback(input: VertexOutput) -> @location(0) vec4<f32> {
    let source_color = textureSample(composite_texture, feedback_sampler, input.uv).rgb;
    let centered = input.uv - vec2<f32>(0.5);
    let rotation_control = ((u.network0.z + u.network0.w) * 0.5 - 0.5) * 0.018;
    let rotation = rotation_control + (u.audio0.z * 0.004 + u.input0.y * 0.008) * sin(u.resolution_time.z * 0.7);
    let cosine_value = cos(rotation);
    let sine_value = sin(rotation);
    let rotated = vec2<f32>(
        centered.x * cosine_value - centered.y * sine_value,
        centered.x * sine_value + centered.y * cosine_value
    );
    let feedback_uv = rotated * (0.997 - u.audio0.y * 0.002) + vec2<f32>(0.5);
    let history_color = textureSample(previous_feedback, feedback_sampler, feedback_uv).rgb;
    let retention = clamp(u.controls0.y, 0.0, 0.995);
    let injected = source_color * (1.0 - retention * 0.48);
    let accumulated = history_color * retention + injected;
    return vec4<f32>(accumulated, 1.0);
}

@fragment
fn fs_present(input: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(final_texture, final_sampler, input.uv).rgb;
    color = vec3<f32>(1.0) - exp(-color * u.controls1.x);
    color = (color - vec3<f32>(0.5)) * u.controls1.y + vec3<f32>(0.5);
    let vignette_position = input.uv * 2.0 - vec2<f32>(1.0);
    let vignette = 1.0 - dot(vignette_position, vignette_position) * 0.12;
    color = max(color * vignette, vec3<f32>(0.0));
    return vec4<f32>(color, 1.0);
}
