use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use std::f32::consts::{PI, TAU};

/// One vertex carries the base shape plus three complete morph targets.
/// The vertex shader reads all four positions and normals, then blends them
/// using the current GPU uniform weights. The topology never changes.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct MorphVertex {
    pub base_position: [f32; 3],
    pub cube_position: [f32; 3],
    pub torus_position: [f32; 3],
    pub bloom_position: [f32; 3],
    pub base_normal: [f32; 3],
    pub cube_normal: [f32; 3],
    pub torus_normal: [f32; 3],
    pub bloom_normal: [f32; 3],
    pub uv: [f32; 2],
}

// Eight vec3 streams plus one vec2 UV: 26 f32 values = 104 bytes.
const _: [(); 104] = [(); std::mem::size_of::<MorphVertex>()];

#[derive(Debug)]
pub struct MorphMesh {
    pub vertices: Vec<MorphVertex>,
    pub indices: Vec<u32>,
    pub latitude_segments: u32,
    pub longitude_segments: u32,
}

impl MorphMesh {
    pub fn procedural(latitude_segments: u32, longitude_segments: u32) -> Self {
        let lat = latitude_segments.max(8);
        let lon = longitude_segments.max(12);
        let vertex_count = ((lat + 1) * (lon + 1)) as usize;

        let mut base_positions = Vec::with_capacity(vertex_count);
        let mut cube_positions = Vec::with_capacity(vertex_count);
        let mut torus_positions = Vec::with_capacity(vertex_count);
        let mut bloom_positions = Vec::with_capacity(vertex_count);
        let mut uvs = Vec::with_capacity(vertex_count);

        for y in 0..=lat {
            let v = y as f32 / lat as f32;
            let latitude = v * PI;
            let sin_latitude = latitude.sin();
            let cos_latitude = latitude.cos();

            for x in 0..=lon {
                let u = x as f32 / lon as f32;
                let longitude = u * TAU;
                let sin_longitude = longitude.sin();
                let cos_longitude = longitude.cos();

                let sphere = Vec3::new(
                    sin_latitude * cos_longitude,
                    cos_latitude,
                    sin_latitude * sin_longitude,
                );
                base_positions.push(sphere);

                // Rounded cube target. Project the sphere ray onto a cube,
                // then retain a little spherical curvature at corners.
                let max_axis = sphere.abs().max_element().max(0.0001);
                let cube_surface = sphere / max_axis * 0.82;
                let rounded_cube = sphere.lerp(cube_surface, 0.88);
                cube_positions.push(rounded_cube);

                // Torus target. It uses the same UV parameterization and index
                // topology, proving that morph targets can radically change
                // silhouette without rebuilding buffers.
                let tube_angle = (v - 0.5) * TAU;
                let major_radius = 0.70;
                let minor_radius = 0.30;
                let radial = major_radius + minor_radius * tube_angle.cos();
                let torus = Vec3::new(
                    radial * cos_longitude,
                    minor_radius * tube_angle.sin(),
                    radial * sin_longitude,
                );
                torus_positions.push(torus);

                // Bloom target. Several spherical harmonics modulate radius,
                // producing petals, ridges, and an elongated vertical profile.
                let petal = (longitude * 6.0).cos() * sin_latitude.powf(2.4);
                let rib = (latitude * 5.0 + longitude * 2.0).sin();
                let ripple = (longitude * 3.0 - latitude * 7.0).cos();
                let radius = 0.86 + petal * 0.19 + rib * 0.10 + ripple * 0.045;
                let mut bloom = sphere * radius;
                bloom.y *= 1.18;
                bloom_positions.push(bloom);

                uvs.push([u, v]);
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

                // Counter-clockwise winding when viewed from outside.
                indices.extend_from_slice(&[a, c, b, c, d, b]);
            }
        }

        let base_normals = compute_normals(&base_positions, &indices);
        let cube_normals = compute_normals(&cube_positions, &indices);
        let torus_normals = compute_normals(&torus_positions, &indices);
        let bloom_normals = compute_normals(&bloom_positions, &indices);

        let mut vertices = Vec::with_capacity(vertex_count);
        for index in 0..vertex_count {
            vertices.push(MorphVertex {
                base_position: base_positions[index].to_array(),
                cube_position: cube_positions[index].to_array(),
                torus_position: torus_positions[index].to_array(),
                bloom_position: bloom_positions[index].to_array(),
                base_normal: base_normals[index].to_array(),
                cube_normal: cube_normals[index].to_array(),
                torus_normal: torus_normals[index].to_array(),
                bloom_normal: bloom_normals[index].to_array(),
                uv: uvs[index],
            });
        }

        Self {
            vertices,
            indices,
            latitude_segments: lat,
            longitude_segments: lon,
        }
    }
}

fn compute_normals(positions: &[Vec3], indices: &[u32]) -> Vec<Vec3> {
    let mut normals = vec![Vec3::ZERO; positions.len()];

    for triangle in indices.chunks_exact(3) {
        let ia = triangle[0] as usize;
        let ib = triangle[1] as usize;
        let ic = triangle[2] as usize;
        let a = positions[ia];
        let b = positions[ib];
        let c = positions[ic];
        let face = (b - a).cross(c - a);

        if face.length_squared() > 1.0e-12 {
            normals[ia] += face;
            normals[ib] += face;
            normals[ic] += face;
        }
    }

    normals
        .into_iter()
        .enumerate()
        .map(|(index, normal)| {
            if normal.length_squared() > 1.0e-12 {
                normal.normalize()
            } else {
                positions[index].normalize_or_zero()
            }
        })
        .collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn procedural_mesh_has_expected_topology() {
        let mesh = MorphMesh::procedural(16, 24);
        assert_eq!(mesh.vertices.len(), 17 * 25);
        assert_eq!(mesh.indices.len(), 16 * 24 * 6);
        assert_eq!(mesh.indices.len() % 3, 0);
    }

    #[test]
    fn all_target_streams_are_finite() {
        let mesh = MorphMesh::procedural(12, 18);
        for vertex in mesh.vertices {
            for value in vertex
                .base_position
                .into_iter()
                .chain(vertex.cube_position)
                .chain(vertex.torus_position)
                .chain(vertex.bloom_position)
                .chain(vertex.base_normal)
                .chain(vertex.cube_normal)
                .chain(vertex.torus_normal)
                .chain(vertex.bloom_normal)
                .chain(vertex.uv)
            {
                assert!(value.is_finite());
            }
        }
    }
}
