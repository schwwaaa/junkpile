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
var<storage, read> particles: array<Particle>;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_position: vec2<f32>,
    @location(1) color: vec3<f32>,
};

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
    let pixel_to_clip = vec2<f32>(2.0 / resolution.x, 2.0 / resolution.y);
    let particle_size = max(u.render.x, 0.25);
    let offset = corner * pixel_to_clip * particle_size;
    let speed_energy = clamp(length(particle.velocity) * 2.5, 0.0, 1.0);

    var output: VertexOutput;
    output.clip_position = vec4<f32>(particle.position + offset, 0.0, 1.0);
    output.local_position = corner;
    output.color = particle.color.rgb * (0.65 + speed_energy * 0.75);
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let radius = length(input.local_position);
    let alpha = 1.0 - smoothstep(0.12, 1.0, radius);
    let core = 1.0 - smoothstep(0.0, 0.34, radius);
    let intensity = alpha * (0.42 + core * 1.6) * max(u.render.y, 0.0);
    return vec4<f32>(input.color * intensity, intensity);
}
