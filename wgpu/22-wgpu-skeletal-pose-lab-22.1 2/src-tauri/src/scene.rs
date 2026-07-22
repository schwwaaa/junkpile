use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Quat, Vec2, Vec3};
use gltf::{
    animation::{util::ReadOutputs, Interpolation},
    buffer, image,
    mesh::Mode,
    Document,
};
use serde::Serialize;
use std::path::Path;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub joints: [u32; 4],
    pub weights: [f32; 4],
}

#[derive(Clone, Copy, Debug)]
pub struct NodePose {
    pub translation: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
}

impl NodePose {
    pub fn matrix(self) -> Mat4 {
        Mat4::from_scale_rotation_translation(self.scale, self.rotation, self.translation)
    }
}

#[derive(Clone, Debug)]
pub struct CpuNode {
    pub name: String,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub base_pose: NodePose,
    pub mesh_index: Option<usize>,
    pub skin_index: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct CpuSkin {
    pub name: String,
    pub joints: Vec<usize>,
    pub inverse_bind_matrices: Vec<Mat4>,
}

#[derive(Clone, Copy, Debug)]
pub enum ChannelInterpolation {
    Linear,
    Step,
}

#[derive(Clone, Debug)]
pub enum ChannelValues {
    Translations(Vec<Vec3>),
    Rotations(Vec<Quat>),
    Scales(Vec<Vec3>),
}

#[derive(Clone, Debug)]
pub struct CpuAnimationChannel {
    pub node_index: usize,
    pub times: Vec<f32>,
    pub values: ChannelValues,
    pub interpolation: ChannelInterpolation,
}

#[derive(Clone, Debug)]
pub struct CpuAnimation {
    pub name: String,
    pub duration: f32,
    pub channels: Vec<CpuAnimationChannel>,
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
    pub node_index: usize,
    pub skin_index: Option<usize>,
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
    pub joint_count: u32,
    pub vertex_count: u64,
    pub index_count: u64,
    pub triangle_count: u64,
    pub weighted_vertex_count: u64,
    pub skipped_primitive_count: u32,
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JointInfo {
    pub list_index: usize,
    pub node_index: usize,
    pub skin_index: usize,
    pub skin_joint_index: usize,
    pub name: String,
    pub parent_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationInfo {
    pub index: usize,
    pub name: String,
    pub duration: f32,
    pub channel_count: usize,
}

#[derive(Clone, Debug)]
pub struct CpuScene {
    pub primitives: Vec<CpuPrimitive>,
    pub materials: Vec<CpuMaterial>,
    pub images: Vec<CpuImage>,
    pub nodes: Vec<CpuNode>,
    pub scene_roots: Vec<usize>,
    pub skins: Vec<CpuSkin>,
    pub animations: Vec<CpuAnimation>,
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
            "bundled://sample-skinned.glb".to_string(),
        )
    }

    pub fn base_poses(&self) -> Vec<NodePose> {
        self.nodes.iter().map(|node| node.base_pose).collect()
    }

    pub fn world_matrices(&self, poses: &[NodePose]) -> Vec<Mat4> {
        let mut cache = vec![None; self.nodes.len()];
        let mut visiting = vec![false; self.nodes.len()];
        for index in 0..self.nodes.len() {
            compute_world(index, &self.nodes, poses, &mut cache, &mut visiting);
        }
        cache
            .into_iter()
            .map(|matrix| matrix.unwrap_or(Mat4::IDENTITY))
            .collect()
    }

    pub fn joint_infos(&self) -> Vec<JointInfo> {
        let mut result = Vec::new();
        for (skin_index, skin) in self.skins.iter().enumerate() {
            for (skin_joint_index, &node_index) in skin.joints.iter().enumerate() {
                if result.iter().any(|item: &JointInfo| item.node_index == node_index) {
                    continue;
                }
                let node = &self.nodes[node_index];
                let parent_name = node
                    .parent
                    .and_then(|parent| self.nodes.get(parent))
                    .map(|parent| parent.name.clone())
                    .unwrap_or_else(|| "scene root".into());
                result.push(JointInfo {
                    list_index: result.len(),
                    node_index,
                    skin_index,
                    skin_joint_index,
                    name: node.name.clone(),
                    parent_name,
                });
            }
        }
        result
    }

    pub fn animation_infos(&self) -> Vec<AnimationInfo> {
        self.animations
            .iter()
            .enumerate()
            .map(|(index, animation)| AnimationInfo {
                index,
                name: animation.name.clone(),
                duration: animation.duration,
                channel_count: animation.channels.len(),
            })
            .collect()
    }

    pub fn sample_animation(&self, animation_index: usize, time: f32, blend: f32) -> Vec<NodePose> {
        let mut poses = self.base_poses();
        let Some(animation) = self.animations.get(animation_index) else {
            return poses;
        };
        let blend = blend.clamp(0.0, 1.0);
        for channel in &animation.channels {
            let Some(base) = self.nodes.get(channel.node_index).map(|node| node.base_pose) else {
                continue;
            };
            let Some(pose) = poses.get_mut(channel.node_index) else {
                continue;
            };
            match &channel.values {
                ChannelValues::Translations(values) => {
                    if let Some(value) = sample_vec3(&channel.times, values, time, channel.interpolation) {
                        pose.translation = base.translation.lerp(value, blend);
                    }
                }
                ChannelValues::Rotations(values) => {
                    if let Some(value) = sample_quat(&channel.times, values, time, channel.interpolation) {
                        pose.rotation = base.rotation.slerp(value, blend).normalize();
                    }
                }
                ChannelValues::Scales(values) => {
                    if let Some(value) = sample_vec3(&channel.times, values, time, channel.interpolation) {
                        pose.scale = base.scale.lerp(value, blend);
                    }
                }
            }
        }
        poses
    }
}

fn compute_world(
    index: usize,
    nodes: &[CpuNode],
    poses: &[NodePose],
    cache: &mut [Option<Mat4>],
    visiting: &mut [bool],
) -> Mat4 {
    if let Some(matrix) = cache.get(index).and_then(|value| *value) {
        return matrix;
    }
    if visiting.get(index).copied().unwrap_or(false) {
        return Mat4::IDENTITY;
    }
    if let Some(value) = visiting.get_mut(index) {
        *value = true;
    }
    let local = poses
        .get(index)
        .copied()
        .unwrap_or(NodePose {
            translation: Vec3::ZERO,
            rotation: Quat::IDENTITY,
            scale: Vec3::ONE,
        })
        .matrix();
    let world = nodes
        .get(index)
        .and_then(|node| node.parent)
        .map(|parent| compute_world(parent, nodes, poses, cache, visiting) * local)
        .unwrap_or(local);
    if let Some(value) = cache.get_mut(index) {
        *value = Some(world);
    }
    if let Some(value) = visiting.get_mut(index) {
        *value = false;
    }
    world
}

fn sample_interval(times: &[f32], time: f32) -> Option<(usize, usize, f32)> {
    if times.is_empty() {
        return None;
    }
    if times.len() == 1 || time <= times[0] {
        return Some((0, 0, 0.0));
    }
    let last = times.len() - 1;
    if time >= times[last] {
        return Some((last, last, 0.0));
    }
    let upper = times.partition_point(|sample| *sample <= time).min(last);
    let lower = upper.saturating_sub(1);
    let span = (times[upper] - times[lower]).max(f32::EPSILON);
    Some((lower, upper, ((time - times[lower]) / span).clamp(0.0, 1.0)))
}

fn sample_vec3(
    times: &[f32],
    values: &[Vec3],
    time: f32,
    interpolation: ChannelInterpolation,
) -> Option<Vec3> {
    let (a, b, mix) = sample_interval(times, time)?;
    let first = *values.get(a)?;
    let second = *values.get(b).unwrap_or(&first);
    Some(match interpolation {
        ChannelInterpolation::Step => first,
        ChannelInterpolation::Linear => first.lerp(second, mix),
    })
}

fn sample_quat(
    times: &[f32],
    values: &[Quat],
    time: f32,
    interpolation: ChannelInterpolation,
) -> Option<Quat> {
    let (a, b, mix) = sample_interval(times, time)?;
    let first = *values.get(a)?;
    let second = *values.get(b).unwrap_or(&first);
    Some(match interpolation {
        ChannelInterpolation::Step => first,
        ChannelInterpolation::Linear => first.slerp(second, mix).normalize(),
    })
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
    let scene_roots = selected_scene.nodes().map(|node| node.index()).collect::<Vec<_>>();
    let scene_name = selected_scene
        .name()
        .map(str::to_string)
        .unwrap_or(fallback_name);

    let mut nodes = document
        .nodes()
        .map(|node| {
            let (translation, rotation, scale) = node.transform().decomposed();
            CpuNode {
                name: node
                    .name()
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Node {}", node.index())),
                parent: None,
                children: node.children().map(|child| child.index()).collect(),
                base_pose: NodePose {
                    translation: Vec3::from_array(translation),
                    rotation: Quat::from_array(rotation).normalize(),
                    scale: Vec3::from_array(scale),
                },
                mesh_index: node.mesh().map(|mesh| mesh.index()),
                skin_index: node.skin().map(|skin| skin.index()),
            }
        })
        .collect::<Vec<_>>();
    for parent in 0..nodes.len() {
        let children = nodes[parent].children.clone();
        for child in children {
            if let Some(node) = nodes.get_mut(child) {
                node.parent = Some(parent);
            }
        }
    }

    let skins = document
        .skins()
        .map(|skin| {
            let joints = skin.joints().map(|node| node.index()).collect::<Vec<_>>();
            let inverse_bind_matrices = skin
                .reader(|buffer| Some(buffers[buffer.index()].0.as_slice()))
                .read_inverse_bind_matrices()
                .map(|values| {
                    values
                        .map(|matrix| Mat4::from_cols_array_2d(&matrix))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![Mat4::IDENTITY; joints.len()]);
            CpuSkin {
                name: skin
                    .name()
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Skin {}", skin.index())),
                joints,
                inverse_bind_matrices,
            }
        })
        .collect::<Vec<_>>();

    let animations = document
        .animations()
        .map(|animation| {
            let mut channels = Vec::new();
            let mut duration = 0.0f32;
            for channel in animation.channels() {
                let reader = channel.reader(|buffer| Some(buffers[buffer.index()].0.as_slice()));
                let Some(inputs) = reader.read_inputs() else {
                    continue;
                };
                let times = inputs.collect::<Vec<_>>();
                duration = duration.max(times.last().copied().unwrap_or(0.0));
                let Some(outputs) = reader.read_outputs() else {
                    continue;
                };
                let interpolation = match channel.sampler().interpolation() {
                    Interpolation::Step => ChannelInterpolation::Step,
                    Interpolation::Linear | Interpolation::CubicSpline => ChannelInterpolation::Linear,
                };
                let is_cubic = matches!(channel.sampler().interpolation(), Interpolation::CubicSpline);
                let values = match outputs {
                    ReadOutputs::Translations(values) => {
                        let raw = values.map(Vec3::from_array).collect::<Vec<_>>();
                        ChannelValues::Translations(collapse_cubic(raw, is_cubic))
                    }
                    ReadOutputs::Rotations(values) => {
                        let raw = values
                            .into_f32()
                            .map(|value| Quat::from_array(value).normalize())
                            .collect::<Vec<_>>();
                        ChannelValues::Rotations(collapse_cubic(raw, is_cubic))
                    }
                    ReadOutputs::Scales(values) => {
                        let raw = values.map(Vec3::from_array).collect::<Vec<_>>();
                        ChannelValues::Scales(collapse_cubic(raw, is_cubic))
                    }
                    ReadOutputs::MorphTargetWeights(_) => continue,
                };
                channels.push(CpuAnimationChannel {
                    node_index: channel.target().node().index(),
                    times,
                    values,
                    interpolation,
                });
            }
            CpuAnimation {
                name: animation
                    .name()
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Animation {}", animation.index())),
                duration,
                channels,
            }
        })
        .collect::<Vec<_>>();

    let rest_poses = nodes.iter().map(|node| node.base_pose).collect::<Vec<_>>();
    let rest_world = {
        let temp = CpuScene {
            primitives: Vec::new(),
            materials: Vec::new(),
            images: Vec::new(),
            nodes: nodes.clone(),
            scene_roots: scene_roots.clone(),
            skins: skins.clone(),
            animations: Vec::new(),
            stats: SceneStats::default(),
        };
        temp.world_matrices(&rest_poses)
    };

    let mut primitives = Vec::new();
    let mut bounds_min = Vec3::splat(f32::INFINITY);
    let mut bounds_max = Vec3::splat(f32::NEG_INFINITY);
    let mut skipped = 0u32;
    let mut weighted_vertex_count = 0u64;

    for node in document.nodes() {
        let Some(mesh) = node.mesh() else {
            continue;
        };
        for primitive in mesh.primitives() {
            if primitive.mode() != Mode::Triangles {
                skipped += 1;
                continue;
            }
            let reader = primitive.reader(|buffer| Some(buffers[buffer.index()].0.as_slice()));
            let positions = reader
                .read_positions()
                .ok_or_else(|| format!("mesh '{}' contains a primitive without POSITION data", mesh.name().unwrap_or("unnamed")))?
                .map(Vec3::from_array)
                .collect::<Vec<_>>();
            let indices = reader
                .read_indices()
                .map(|values| values.into_u32().collect::<Vec<_>>())
                .unwrap_or_else(|| (0..positions.len() as u32).collect());
            let normals = reader
                .read_normals()
                .map(|values| values.map(Vec3::from_array).collect::<Vec<_>>())
                .unwrap_or_else(|| generate_normals(&positions, &indices));
            let tex_coords = reader
                .read_tex_coords(0)
                .map(|values| values.into_f32().map(Vec2::from_array).collect::<Vec<_>>())
                .unwrap_or_else(|| vec![Vec2::ZERO; positions.len()]);
            let joint_values = reader
                .read_joints(0)
                .map(|values| values.into_u16().map(|value| value.map(u32::from)).collect::<Vec<_>>())
                .unwrap_or_else(|| vec![[0, 0, 0, 0]; positions.len()]);
            let weight_values = reader
                .read_weights(0)
                .map(|values| values.into_f32().collect::<Vec<_>>())
                .unwrap_or_else(|| vec![[1.0, 0.0, 0.0, 0.0]; positions.len()]);

            let node_world = rest_world.get(node.index()).copied().unwrap_or(Mat4::IDENTITY);
            let mut vertices = Vec::with_capacity(positions.len());
            for index in 0..positions.len() {
                let weights = normalize_weights(weight_values.get(index).copied().unwrap_or([1.0, 0.0, 0.0, 0.0]));
                if weights.iter().skip(1).any(|weight| *weight > 0.0001) {
                    weighted_vertex_count += 1;
                }
                let world_position = node_world.transform_point3(positions[index]);
                bounds_min = bounds_min.min(world_position);
                bounds_max = bounds_max.max(world_position);
                vertices.push(Vertex {
                    position: positions[index].to_array(),
                    normal: normals.get(index).copied().unwrap_or(Vec3::Y).to_array(),
                    uv: tex_coords.get(index).copied().unwrap_or(Vec2::ZERO).to_array(),
                    joints: joint_values.get(index).copied().unwrap_or([0, 0, 0, 0]),
                    weights,
                });
            }
            primitives.push(CpuPrimitive {
                vertices,
                indices,
                material_index: primitive.material().index().unwrap_or(default_material_index),
                node_index: node.index(),
                skin_index: node.skin().map(|skin| skin.index()),
            });
        }
    }

    if primitives.is_empty() {
        return Err("the selected glTF scene contains no triangle primitives".into());
    }
    if !bounds_min.is_finite() || !bounds_max.is_finite() {
        bounds_min = Vec3::splat(-1.0);
        bounds_max = Vec3::splat(1.0);
    }

    let vertex_count = primitives.iter().map(|primitive| primitive.vertices.len() as u64).sum();
    let index_count = primitives.iter().map(|primitive| primitive.indices.len() as u64).sum();
    let joint_count = skins.iter().map(|skin| skin.joints.len()).sum::<usize>() as u32;

    Ok(CpuScene {
        stats: SceneStats {
            scene_name,
            source_path,
            node_count: nodes.len() as u32,
            mesh_count: document.meshes().count() as u32,
            primitive_count: primitives.len() as u32,
            material_count: materials.len() as u32,
            texture_count: converted_images.len() as u32,
            camera_count: document.cameras().count() as u32,
            animation_count: animations.len() as u32,
            skin_count: skins.len() as u32,
            joint_count,
            vertex_count,
            index_count,
            triangle_count: index_count / 3,
            weighted_vertex_count,
            skipped_primitive_count: skipped,
            bounds_min: bounds_min.to_array(),
            bounds_max: bounds_max.to_array(),
        },
        primitives,
        materials,
        images: converted_images,
        nodes,
        scene_roots,
        skins,
        animations,
    })
}

fn collapse_cubic<T: Copy>(values: Vec<T>, cubic: bool) -> Vec<T> {
    if !cubic {
        return values;
    }
    values.chunks(3).filter_map(|chunk| chunk.get(1).copied()).collect()
}

fn normalize_weights(mut weights: [f32; 4]) -> [f32; 4] {
    let sum = weights.iter().sum::<f32>();
    if sum <= f32::EPSILON {
        return [1.0, 0.0, 0.0, 0.0];
    }
    for weight in &mut weights {
        *weight = (*weight / sum).max(0.0);
    }
    weights
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
    normals.into_iter().map(|normal| normal.normalize_or_zero()).collect()
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
            for chunk in data.pixels.chunks_exact(2) {
                let r = u16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 65535.0;
                let r = float_to_u8(r);
                rgba.extend_from_slice(&[r, r, r, 255]);
            }
        }
        image::Format::R16G16 => {
            for chunk in data.pixels.chunks_exact(4) {
                let r = float_to_u8(u16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 65535.0);
                let a = float_to_u8(u16::from_le_bytes([chunk[2], chunk[3]]) as f32 / 65535.0);
                rgba.extend_from_slice(&[r, r, r, a]);
            }
        }
        image::Format::R16G16B16 => {
            for chunk in data.pixels.chunks_exact(6) {
                rgba.extend_from_slice(&[
                    float_to_u8(u16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 65535.0),
                    float_to_u8(u16::from_le_bytes([chunk[2], chunk[3]]) as f32 / 65535.0),
                    float_to_u8(u16::from_le_bytes([chunk[4], chunk[5]]) as f32 / 65535.0),
                    255,
                ]);
            }
        }
        image::Format::R16G16B16A16 => {
            for chunk in data.pixels.chunks_exact(8) {
                for pair in chunk.chunks_exact(2) {
                    rgba.push(float_to_u8(u16::from_le_bytes([pair[0], pair[1]]) as f32 / 65535.0));
                }
            }
        }
        image::Format::R32G32B32FLOAT => {
            for chunk in data.pixels.chunks_exact(12) {
                for component in chunk.chunks_exact(4) {
                    rgba.push(float_to_u8(f32::from_le_bytes(component.try_into().unwrap())));
                }
                rgba.push(255);
            }
        }
        image::Format::R32G32B32A32FLOAT => {
            for chunk in data.pixels.chunks_exact(16) {
                for component in chunk.chunks_exact(4) {
                    rgba.push(float_to_u8(f32::from_le_bytes(component.try_into().unwrap())));
                }
            }
        }
    }
    if rgba.len() != pixel_count * 4 {
        return Err("decoded glTF image produced an unexpected byte count".into());
    }
    Ok(CpuImage { width: data.width, height: data.height, rgba })
}

fn float_to_u8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}
