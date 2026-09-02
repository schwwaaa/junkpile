use std::{env, path::{Path, PathBuf}};

fn main() {
    println!("cargo:rerun-if-env-changed=NDI_SDK_DIR");

    #[cfg(target_os = "macos")]
    configure_ndi_runtime_rpath();

    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn configure_ndi_runtime_rpath() {
    // The grafton-ndi build script adds the SDK directory as a link-search path,
    // which is sufficient to link the executable. The NDI dylib itself uses the
    // install name `@rpath/libndi.dylib`, so the final application also needs a
    // runtime search path. Without this, the project compiles but dyld aborts at
    // launch with "Library not loaded: @rpath/libndi.dylib".
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

    // Development: resolve directly from the locally installed SDK.
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", library_dir.display());

    // Future bundled builds can place libndi.dylib next to the executable or in
    // the application Frameworks directory without changing Rust code.
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");

    println!(
        "cargo:warning=NDI runtime rpath configured from {}",
        library_dir.display()
    );
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
