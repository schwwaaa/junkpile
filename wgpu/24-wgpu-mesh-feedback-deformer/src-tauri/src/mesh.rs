use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use std::f32::consts::{PI, TAU};

/// Complete persistent state for one simulated vertex.
///
/// The two storage buffers contain identical arrays of this structure. A compute
/// pass reads one array and writes the next frame into the other array. The render
/// pass then reads the newly written array directly as storage data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct FeedbackVertex {
    /// xyz = current position, w = U coordinate
    pub position_u: [f32; 4],
    /// xyz = persistent velocity, w = V coordinate
    pub velocity_v: [f32; 4],
    /// xyz = surface normal, w = distance from the rest position
    pub normal_displacement: [f32; 4],
    /// xyz = immutable rest position, w = stable per-vertex seed
    pub rest_seed: [f32; 4],
}

// Four vec4 values = 64 bytes. This must remain byte-identical to WGSL VertexState.
const _: [(); 64] = [(); std::mem::size_of::<FeedbackVertex>()];

#[derive(Debug)]
pub struct FeedbackMesh {
    pub vertices: Vec<FeedbackVertex>,
    pub indices: Vec<u32>,
    pub latitude_segments: u32,
    pub longitude_segments: u32,
}

impl FeedbackMesh {
    pub fn sphere(latitude_segments: u32, longitude_segments: u32) -> Self {
        let lat = latitude_segments.max(8);
        let lon = longitude_segments.max(12);
        let mut vertices = Vec::with_capacity(((lat + 1) * (lon + 1)) as usize);

        for y in 0..=lat {
            let v = y as f32 / lat as f32;
            let latitude = v * PI;
            let sin_latitude = latitude.sin();
            let cos_latitude = latitude.cos();

            for x in 0..=lon {
                let u = x as f32 / lon as f32;
                let longitude = u * TAU;
                let position = Vec3::new(
                    sin_latitude * longitude.cos(),
                    cos_latitude,
                    sin_latitude * longitude.sin(),
                );
                let seed = hash01(x, y);

                vertices.push(FeedbackVertex {
                    position_u: [position.x, position.y, position.z, u],
                    velocity_v: [0.0, 0.0, 0.0, v],
                    normal_displacement: [position.x, position.y, position.z, 0.0],
                    rest_seed: [position.x, position.y, position.z, seed],
                });
            }
        }

        let mut indices = Vec::with_capacity((lat * lon * 6) as usize);
        let row = lon + 1;
        for y in 0..lat {
            for x in 0..lon {
                let a = y * row + x;
                let b = a + row;
                let c = a + 1;
                let d = b + 1;
                indices.extend_from_slice(&[a, c, b, c, d, b]);
            }
        }

        Self {
            vertices,
            indices,
            latitude_segments: lat,
            longitude_segments: lon,
        }
    }
}

fn hash01(x: u32, y: u32) -> f32 {
    let mut value = x
        .wrapping_mul(0x9E37_79B9)
        .wrapping_add(y.wrapping_mul(0x85EB_CA6B))
        .wrapping_add(0xC2B2_AE35);
    value ^= value >> 16;
    value = value.wrapping_mul(0x7FEB_352D);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846C_A68B);
    value ^= value >> 16;
    value as f32 / u32::MAX as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sphere_has_expected_topology() {
        let mesh = FeedbackMesh::sphere(16, 24);
        assert_eq!(mesh.vertices.len(), 17 * 25);
        assert_eq!(mesh.indices.len(), 16 * 24 * 6);
    }

    #[test]
    fn initial_state_is_finite() {
        let mesh = FeedbackMesh::sphere(12, 18);
        for vertex in mesh.vertices {
            for value in vertex
                .position_u
                .into_iter()
                .chain(vertex.velocity_v)
                .chain(vertex.normal_displacement)
                .chain(vertex.rest_seed)
            {
                assert!(value.is_finite());
            }
        }
    }
}
