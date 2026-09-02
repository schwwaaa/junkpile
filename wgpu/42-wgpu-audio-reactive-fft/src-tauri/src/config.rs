use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewScaleMode {
    Fit,
    Fill,
    Stretch,
    Pixel,
}

impl PreviewScaleMode {
    pub fn as_u32(self) -> u32 {
        match self {
            Self::Fit => 0,
            Self::Fill => 1,
            Self::Stretch => 2,
            Self::Pixel => 3,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fit => "fit",
            Self::Fill => "fill",
            Self::Stretch => "stretch",
            Self::Pixel => "pixel",
        }
    }
}
