use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelFormat {
    Rgba8UnormSrgb,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FrameOrigin {
    TopLeft,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorSpace {
    Srgb,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rational {
    pub numerator: u32,
    pub denominator: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub width: u32,
    pub height: u32,
    pub pixel_format: PixelFormat,
    pub origin: FrameOrigin,
    pub color_space: ColorSpace,
    pub alpha: String,
    pub nominal_fps: Rational,
}

impl FrameDescriptor {
    pub fn rgba_srgb(width: u32, height: u32, fps_n: u32, fps_d: u32) -> Self {
        Self {
            width,
            height,
            pixel_format: PixelFormat::Rgba8UnormSrgb,
            origin: FrameOrigin::TopLeft,
            color_space: ColorSpace::Srgb,
            alpha: "opaque".into(),
            nominal_fps: Rational {
                numerator: fps_n,
                denominator: fps_d.max(1),
            },
        }
    }
}

pub struct VideoFrame<'a> {
    pub texture: &'a wgpu::Texture,
    pub view: &'a wgpu::TextureView,
    pub descriptor: &'a FrameDescriptor,
    pub frame_index: u64,
    pub timestamp_ns: u64,
}
