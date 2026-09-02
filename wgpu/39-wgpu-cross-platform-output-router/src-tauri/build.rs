use std::{env, fs, path::{Path, PathBuf}};

fn main() {
    println!("cargo:rerun-if-env-changed=NDI_SDK_DIR");

    #[cfg(target_os = "macos")]
    {
        configure_ndi_runtime_rpath();
        configure_syphon_bridge();
    }

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var_os("CARGO_FEATURE_SPOUT").is_some()
    {
        build_spout_windows();
    }

    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn configure_ndi_runtime_rpath() {
    if env::var_os("CARGO_FEATURE_NDI").is_none() {
        return;
    }

    let sdk_root = env::var_os("NDI_SDK_DIR")
        .map(PathBuf::from)
        .or_else(find_default_ndi_sdk_root);

    let Some(sdk_root) = sdk_root else {
        println!(
            "cargo:warning=NDI feature is enabled, but no NDI SDK root was found. Set NDI_SDK_DIR before building."
        );
        return;
    };

    let library_dir = [sdk_root.join("lib/macOS"), sdk_root.join("lib")]
        .into_iter()
        .find(|directory| directory.join("libndi.dylib").is_file());

    let Some(library_dir) = library_dir else {
        println!(
            "cargo:warning=NDI SDK found at {}, but libndi.dylib was not found under lib/macOS or lib.",
            sdk_root.display()
        );
        return;
    };

    println!("cargo:rerun-if-changed={}", library_dir.join("libndi.dylib").display());
    println!("cargo:rustc-link-search=native={}", library_dir.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", library_dir.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    println!(
        "cargo:warning=NDI runtime rpath configured from {}",
        library_dir.display()
    );
}

#[cfg(target_os = "macos")]
fn configure_syphon_bridge() {
    if env::var_os("CARGO_FEATURE_SYPHON").is_none() {
        return;
    }

    let manifest = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is unavailable"),
    );
    let native = manifest.join("native");
    let vendor = manifest.join("vendor");
    let framework = vendor.join("Syphon.framework");
    let bridge = native.join("syphon_metal_bridge.m");

    println!("cargo:rerun-if-changed={}", bridge.display());
    println!(
        "cargo:rerun-if-changed={}",
        native.join("syphon_metal_bridge.h").display()
    );
    println!("cargo:rerun-if-changed={}", framework.display());

    cc::Build::new()
        .file(&bridge)
        .include(&native)
        .flag("-fobjc-arc")
        .flag(&format!("-F{}", vendor.display()))
        .compile("junkpile_syphon_metal_bridge");

    println!("cargo:rustc-link-search=framework={}", vendor.display());
    println!("cargo:rustc-link-lib=framework=Syphon");
    println!("cargo:rustc-link-lib=framework=Metal");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", vendor.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    println!(
        "cargo:warning=Syphon Metal bridge and runtime rpath configured from {}",
        framework.display()
    );
}

fn build_spout_windows() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"));
    let bridge_dir = manifest.join("native/spout_bridge");
    let spout2_dir = manifest.join("vendor/spout2");

    println!("cargo:rerun-if-changed={}", bridge_dir.display());
    println!("cargo:rerun-if-changed={}", spout2_dir.display());

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let cmake_profile = if profile.eq_ignore_ascii_case("release") { "Release" } else { "Debug" };
    let dst = cmake::Config::new(&bridge_dir)
        .define("SPOUT2_DIR", spout2_dir.to_string_lossy().as_ref())
        .profile(cmake_profile)
        .build_target("junkpile_spout_bridge")
        .build();

    let library = find_file(&dst, "junkpile_spout_bridge.lib", 10)
        .unwrap_or_else(|| panic!("could not find junkpile_spout_bridge.lib under {}", dst.display()));
    let lib_dir = library.parent().expect("Spout bridge import path has no parent");
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static=junkpile_spout_bridge");
    for library in [
        "d3d11", "dxgi", "user32", "gdi32", "winmm", "psapi", "shell32",
        "advapi32", "version", "comctl32",
    ] {
        println!("cargo:rustc-link-lib={library}");
    }
    println!("cargo:warning=SpoutDX static bridge configured from {}", spout2_dir.display());
}

fn find_file(root: &Path, filename: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 || !root.exists() {
        return None;
    }
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(filename))
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file(&path, filename, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn find_default_ndi_sdk_root() -> Option<PathBuf> {
    const CANDIDATES: &[&str] = &[
        "/Library/NDI SDK for macOS",
        "/Library/NDI SDK for Apple",
        "/Library/NDI 6 SDK",
        "/Library/NDI SDK",
        "/Library/NewTek/NDI SDK",
        "/Library/Application Support/NDI SDK for Apple",
        "/Applications/NDI SDK for Apple",
        "/Applications/NDI 6 SDK",
    ];

    CANDIDATES
        .iter()
        .map(Path::new)
        .find(|path| path.exists())
        .map(Path::to_path_buf)
}
