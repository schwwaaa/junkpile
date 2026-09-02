use std::{env, fs, path::{Path, PathBuf}};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var_os("CARGO_FEATURE_SPOUT").is_some()
    {
        build_spout_windows();
    }
    tauri_build::build();
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
    if depth == 0 || !root.exists() { return None; }
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(filename)) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file(&path, filename, depth - 1) { return Some(found); }
        }
    }
    None
}
