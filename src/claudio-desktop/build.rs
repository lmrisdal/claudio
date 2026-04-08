fn main() {
    tauri_build::build();

    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    build_uninstaller();
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn build_uninstaller() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let bundled_uninstaller =
        manifest_dir.join("../../target/release/claudio-game-uninstaller.exe");

    println!("cargo:rerun-if-changed=../../target/release/claudio-game-uninstaller.exe");

    if !bundled_uninstaller.exists() {
        panic!(
            "claudio-game-uninstaller.exe not found at {}. \
             Build it first: cargo build --release -p claudio-uninstaller",
            bundled_uninstaller.display()
        );
    }
}
