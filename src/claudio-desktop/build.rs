fn main() {
    tauri_build::build();

    // On Windows release builds, compile the standalone uninstaller so Tauri
    // can bundle it as a resource. In the workspace layout the compiled binary
    // ends up at ../../target/release/claudio-game-uninstaller.exe relative to
    // this crate, which matches tauri.windows.conf.json's bundle.resources.
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    build_uninstaller();
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn build_uninstaller() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let uninstaller_dir = manifest_dir.join("../claudio-uninstaller");
    let bundled_uninstaller =
        manifest_dir.join("../../target/release/claudio-game-uninstaller.exe");

    println!("cargo:rerun-if-env-changed=CLAUDIO_SKIP_UNINSTALLER_BUILD");
    println!("cargo:rerun-if-changed=../../target/release/claudio-game-uninstaller.exe");

    if std::env::var_os("CLAUDIO_SKIP_UNINSTALLER_BUILD").is_some() && bundled_uninstaller.exists()
    {
        return;
    }

    let status = std::process::Command::new("cargo")
        .args(["build", "--release"])
        .current_dir(&uninstaller_dir)
        .status()
        .expect("failed to run cargo build for claudio-uninstaller");

    if !status.success() {
        panic!("claudio-uninstaller build failed");
    }

    // Tell Cargo to re-run this if the uninstaller source changes.
    println!("cargo:rerun-if-changed=../claudio-uninstaller/src/main.rs");
    println!("cargo:rerun-if-changed=../claudio-uninstaller/Cargo.toml");
}
