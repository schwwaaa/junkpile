use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec2, Vec3};
use gltf::{buffer, image, mesh::Mode, Document, Node};
use serde::Serialize;
use std::path::Path;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
}

#[derive(Clone, Debug)]
pub struct CpuMaterial {
    pub name: String,
    pub base_color: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub base_color_image: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct CpuImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct CpuPrimitive {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub material_index: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneStats {
    pub scene_name: String,
    pub source_path: String,
    pub node_count: u32,
    pub mesh_count: u32,
    pub primitive_count: u32,
    pub material_count: u32,
    pub texture_count: u32,
    pub camera_count: u32,
    pub animation_count: u32,
    pub skin_count: u32,
    pub vertex_count: u64,
    pub index_count: u64,
    pub triangle_count: u64,
    pub skipped_primitive_count: u32,
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
}

#[derive(Clone, Debug)]
pub struct CpuScene {
    pub primitives: Vec<CpuPrimitive>,
    pub materials: Vec<CpuMaterial>,
    pub images: Vec<CpuImage>,
    pub stats: SceneStats,
}

impl CpuScene {
    pub fn from_path(path: &Path) -> Result<Self, String> {
        let (document, buffers, images) = gltf::import(path)
            .map_err(|error| format!("could not import {}: {error}", path.display()))?;
        build_scene(
            document,
            buffers,
            images,
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("glTF scene")
                .to_string(),
            path.display().to_string(),
        )
    }

    pub fn from_slice(bytes: &[u8], label: &str) -> Result<Self, String> {
        let (document, buffers, images) = gltf::import_slice(bytes)
            .map_err(|error| format!("could not import bundled scene: {error}"))?;
        build_scene(
            document,
            buffers,
            images,
            label.to_string(),
            "bundled://sample-scene.glb".to_string(),
        )
    }
}

fn build_scene(
    document: Document,
    buffers: Vec<buffer::Data>,
    images: Vec<image::Data>,
    fallback_name: String,
    source_path: String,
) -> Result<CpuScene, String> {
    let converted_images = images
        .into_iter()
        .map(convert_image)
        .collect::<Result<Vec<_>, _>>()?;

    let mut materials = document
        .materials()
        .map(|material| {
            let pbr = material.pbr_metallic_roughness();
            CpuMaterial {
                name: material
                    .name()
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Material {}", material.index().unwrap_or(0))),
                base_color: pbr.base_color_factor(),
                metallic: pbr.metallic_factor(),
                roughness: pbr.roughness_factor(),
                base_color_image: pbr
                    .base_color_texture()
                    .map(|info| info.texture().source().index()),
            }
        })
        .collect::<Vec<_>>();

    let default_material_index = materials.len();
    materials.push(CpuMaterial {
        name: "Default material".into(),
        base_color: [0.78, 0.8, 0.86, 1.0],
        metallic: 0.0,
        roughness: 0.55,
        base_color_image: None,
    });

    let selected_scene = document
        .default_scene()
        .or_else(|| document.scenes().next())
        .ok_or_else(|| "the glTF file contains no scene".to_string())?;

    let scene_name = selected_scene
        .name()
        .map(str::to_string)
        .unwrap_or(fallback_name);

    let mut primitives = Vec::new();
    let mut bounds_min = Vec3::splat(f32::INFINITY);
    let mut bounds_max = Vec3::splat(f32::NEG_INFINITY);
    let mut skipped = 0u32;

    for node in selected_scene.nodes() {
        traverse_node(
            node,
            Mat4::IDENTITY,
            &buffers,
            default_material_index,
            &mut primitives,
            &mut bounds_min,
            &mut bounds_max,
            &mut skipped,
        )?;
    }

    if primitives.is_empty() {
        return Err("the selected glTF scene contains no triangle primitives".into());
    }

    let vertex_count = primitives
        .iter()
        .map(|primitive| primitive.vertices.len() as u64)
        .sum();
    let index_count = primitives
        .iter()
        .map(|primitive| primitive.indices.len() as u64)
        .sum();

    Ok(CpuScene {
        stats: SceneStats {
            scene_name,
            source_path,
            node_count: document.nodes().count() as u32,
            mesh_count: document.meshes().count() as u32,
            primitive_count: primitives.len() as u32,
            material_count: materials.len() as u32,
            texture_count: converted_images.len() as u32,
            camera_count: document.cameras().count() as u32,
            animation_count: document.animations().count() as u32,
            skin_count: document.skins().count() as u32,
            vertex_count,
            index_count,
            triangle_count: index_count / 3,
            skipped_primitive_count: skipped,
            bounds_min: bounds_min.to_array(),
            bounds_max: bounds_max.to_array(),
        },
        primitives,
        materials,
        images: converted_images,
    })
}

#[allow(clippy::too_many_arguments)]
fn traverse_node(
    node: Node<'_>,
    parent_transform: Mat4,
    buffers: &[buffer::Data],
    default_material_index: usize,
    primitives: &mut Vec<CpuPrimitive>,
    bounds_min: &mut Vec3,
    bounds_max: &mut Vec3,
    skipped: &mut u32,
) -> Result<(), String> {
    let local = Mat4::from_cols_array_2d(&node.transform().matrix());
    let world = parent_transform * local;

    if let Some(mesh) = node.mesh() {
        for primitive in mesh.primitives() {
            if primitive.mode() != Mode::Triangles {
                *skipped += 1;
                continue;
            }

            let reader = primitive.reader(|buffer| Some(buffers[buffer.index()].0.as_slice()));
            let local_positions = reader
                .read_positions()
                .ok_or_else(|| format!("mesh '{}' contains a primitive without POSITION data", mesh.name().unwrap_or("unnamed")))?
                .map(Vec3::from_array)
                .collect::<Vec<_>>();

            let indices = reader
                .read_indices()
                .map(|values| values.into_u32().collect::<Vec<_>>())
                .unwrap_or_else(|| (0..local_positions.len() as u32).collect());

            let local_normals = reader
                .read_normals()
                .map(|values| values.map(Vec3::from_array).collect::<Vec<_>>());
            let tex_coords = reader
                .read_tex_coords(0)
                .map(|values| values.into_f32().map(Vec2::from_array).collect::<Vec<_>>())
                .unwrap_or_else(|| vec![Vec2::ZERO; local_positions.len()]);

            let transformed_positions = local_positions
                .iter()
                .map(|position| world.transform_point3(*position))
                .collect::<Vec<_>>();

            let transformed_normals = if let Some(normals) = local_normals {
                let normal_matrix = world.inverse().transpose();
                normals
                    .into_iter()
                    .map(|normal| normal_matrix.transform_vector3(normal).normalize_or_zero())
                    .collect::<Vec<_>>()
            } else {
                generate_normals(&transformed_positions, &indices)
            };

            let mut vertices = Vec::with_capacity(transformed_positions.len());
            for index in 0..transformed_positions.len() {
                let position = transformed_positions[index];
                *bounds_min = (*bounds_min).min(position);
                *bounds_max = (*bounds_max).max(position);
                vertices.push(Vertex {
                    position: position.to_array(),
                    normal: transformed_normals
                        .get(index)
                        .copied()
                        .unwrap_or(Vec3::Y)
                        .to_array(),
                    uv: tex_coords.get(index).copied().unwrap_or(Vec2::ZERO).to_array(),
                });
            }

            primitives.push(CpuPrimitive {
                vertices,
                indices,
                material_index: primitive
                    .material()
                    .index()
                    .unwrap_or(default_material_index),
            });
        }
    }

    for child in node.children() {
        traverse_node(
            child,
            world,
            buffers,
            default_material_index,
            primitives,
            bounds_min,
            bounds_max,
            skipped,
        )?;
    }

    Ok(())
}

fn generate_normals(positions: &[Vec3], indices: &[u32]) -> Vec<Vec3> {
    let mut normals = vec![Vec3::ZERO; positions.len()];
    for triangle in indices.chunks_exact(3) {
        let a = triangle[0] as usize;
        let b = triangle[1] as usize;
        let c = triangle[2] as usize;
        if a >= positions.len() || b >= positions.len() || c >= positions.len() {
            continue;
        }
        let normal = (positions[b] - positions[a]).cross(positions[c] - positions[a]);
        normals[a] += normal;
        normals[b] += normal;
        normals[c] += normal;
    }
    normals
        .into_iter()
        .map(|normal| normal.normalize_or_zero())
        .collect()
}

fn float_to_u8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

fn convert_image(data: image::Data) -> Result<CpuImage, String> {
    let pixel_count = data.width as usize * data.height as usize;
    let mut rgba = Vec::with_capacity(pixel_count * 4);

    match data.format {
        image::Format::R8 => {
            for &r in &data.pixels {
                rgba.extend_from_slice(&[r, r, r, 255]);
            }
        }
        image::Format::R8G8 => {
            for pair in data.pixels.chunks_exact(2) {
                rgba.extend_from_slice(&[pair[0], pair[0], pair[0], pair[1]]);
            }
        }
        image::Format::R8G8B8 => {
            for rgb in data.pixels.chunks_exact(3) {
                rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            }
        }
        image::Format::R8G8B8A8 => rgba.extend_from_slice(&data.pixels),
        image::Format::R16 => {
            for pair in data.pixels.chunks_exact(2) {
                let r = pair[1];
                rgba.extend_from_slice(&[r, r, r, 255]);
            }
        }
        image::Format::R16G16 => {
            for values in data.pixels.chunks_exact(4) {
                let r = values[1];
                let a = values[3];
                rgba.extend_from_slice(&[r, r, r, a]);
            }
        }
        image::Format::R16G16B16 => {
            for values in data.pixels.chunks_exact(6) {
                rgba.extend_from_slice(&[values[1], values[3], values[5], 255]);
            }
        }
        image::Format::R16G16B16A16 => {
            for values in data.pixels.chunks_exact(8) {
                rgba.extend_from_slice(&[values[1], values[3], values[5], values[7]]);
            }
        }
        image::Format::R32G32B32FLOAT => {
            for values in data.pixels.chunks_exact(12) {
                let r = f32::from_le_bytes(values[0..4].try_into().unwrap());
                let g = f32::from_le_bytes(values[4..8].try_into().unwrap());
                let b = f32::from_le_bytes(values[8..12].try_into().unwrap());
                rgba.extend_from_slice(&[float_to_u8(r), float_to_u8(g), float_to_u8(b), 255]);
            }
        }
        image::Format::R32G32B32A32FLOAT => {
            for values in data.pixels.chunks_exact(16) {
                let r = f32::from_le_bytes(values[0..4].try_into().unwrap());
                let g = f32::from_le_bytes(values[4..8].try_into().unwrap());
                let b = f32::from_le_bytes(values[8..12].try_into().unwrap());
                let a = f32::from_le_bytes(values[12..16].try_into().unwrap());
                rgba.extend_from_slice(&[float_to_u8(r), float_to_u8(g), float_to_u8(b), float_to_u8(a)]);
            }
        }
    }

    if rgba.len() != pixel_count * 4 {
        return Err(format!(
            "decoded image size mismatch: expected {} RGBA bytes, received {}",
            pixel_count * 4,
            rgba.len()
        ));
    }

    Ok(CpuImage {
        width: data.width,
        height: data.height,
        rgba,
    })
}
