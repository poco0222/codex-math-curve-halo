fn main() {
    let target = std::env::var("TARGET").expect("Cargo must provide TARGET");
    println!("cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE={target}");

    if std::env::var_os("CODEX_HALO_BUILD_SIDECAR").is_none() {
        tauri_build::build();
    }
}
