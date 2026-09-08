fn main() {
    let target = std::env::var("TARGET").expect("Cargo must provide TARGET");
    println!("cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE={target}");

    if target.contains("apple-darwin") {
        cc::Build::new()
            .file("src/audio/macos.m")
            // Keep tap symbols weak on the app's existing pre-14.2 deployment range.
            .flag(if target.starts_with("aarch64") {
                "-mmacosx-version-min=11.0"
            } else {
                "-mmacosx-version-min=10.13"
            })
            .flag("-fobjc-arc")
            .flag("-Werror=unguarded-availability-new")
            .compile("halo_system_audio");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rerun-if-changed=src/audio/macos.m");
    }

    if std::env::var_os("CODEX_HALO_BUILD_SIDECAR").is_none() {
        tauri_build::build();
    }
}
