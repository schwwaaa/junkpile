use std::{env, path::PathBuf};

fn main() {
    #[cfg(target_os = "macos")]
    configure_syphon_bridge();

    tauri_build::build();
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

    // Syphon.framework uses @rpath. Point development binaries at the vendored
    // framework and leave bundle-compatible fallbacks for packaged builds.
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", vendor.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    println!(
        "cargo:warning=Syphon Metal bridge and runtime rpath configured from {}",
        framework.display()
    );
}
