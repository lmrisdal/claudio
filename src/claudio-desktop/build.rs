fn main() {
    tauri_build::build();

    // On Windows release builds, compile the standalone uninstaller so Tauri
    // can bundle it as a resource. The compiled binary ends up at
    // ../claudio-uninstaller/target/release/uninstall.exe, which is the path
    // declared in tauri.conf.json's bundle.resources.
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    build_uninstaller();
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn build_uninstaller() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let uninstaller_dir = manifest_dir.join("../claudio-uninstaller");

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
    println!(
        "cargo:rerun-if-changed=../claudio-uninstaller/target/release/claudio-game-uninstaller.exe"
    );
}
