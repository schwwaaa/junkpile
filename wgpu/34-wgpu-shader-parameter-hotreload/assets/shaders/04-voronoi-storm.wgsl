struct Uniforms {
    timing: vec4<f32>,
    resolution: vec4<f32>,
    params: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

const LIVE_EDIT_TINT: f32 = 0.0;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var output: VertexOutput;
    let position = positions[vertex_index];
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.uv = position * 0.5 + vec2<f32>(0.5);
    return output;
}

fn rotate2(p: vec2<f32>, angle: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn palette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.50, 0.50, 0.50);
    let b = vec3<f32>(0.50, 0.50, 0.50);
    let c = vec3<f32>(1.00, 1.00, 1.00);
    let d = vec3<f32>(0.00, 0.10, 0.20);
    return a + b * cos(TAU * (c * t + d));
}

fn hash2(p: vec2<f32>) -> vec2<f32> {
    let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
    return fract(sin(q) * vec2<f32>(43758.5453));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = u.timing.x;
    let gain = u.params.x;
    let zoom = u.params.y;
    let spin_speed = u.params.z;
    let complexity = u.params.w;
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    var p = (input.uv - 0.5) * vec2<f32>(aspect, 1.0);
    p = rotate2(p, time * spin_speed) * (2.0 + zoom * (1.4 + complexity * 0.12));
    let cell = floor(p);
    let local = fract(p);
    var nearest = 100.0;
    var second_nearest = 100.0;
    var identity = 0.0;
    for (var y: i32 = -2; y <= 2; y = y + 1) {
        for (var x: i32 = -2; x <= 2; x = x + 1) {
            let offset = vec2<f32>(f32(x), f32(y));
            let random = hash2(cell + offset);
            let speed = 0.18 + complexity * 0.025;
            let animated = vec2<f32>(0.5) + vec2<f32>(0.42) * sin(vec2<f32>(time * speed) + TAU * random);
            let delta = offset + animated - local;
            let distance_value = dot(delta, delta);
            if (distance_value < nearest) {
                second_nearest = nearest;
                nearest = distance_value;
                identity = random.x;
            } else if (distance_value < second_nearest) {
                second_nearest = distance_value;
            }
        }
    }
    let edge = smoothstep(0.0, 0.12 + 0.025 * gain, sqrt(second_nearest) - sqrt(nearest));
    let pulse = 0.5 + 0.5 * sin(sqrt(nearest) * 28.0 - time * 1.5);
    var color = palette(identity + pulse * 0.18 + time * 0.012);
    color = color * (0.22 + gain * 1.45) * (0.25 + edge * 0.95);
    color = color + (1.0 - edge) * vec3<f32>(0.8, 0.95, 1.0) * 0.65;
    color = color + LIVE_EDIT_TINT * vec3<f32>(0.15, 0.03, 0.24);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
