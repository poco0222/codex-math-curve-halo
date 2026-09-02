fn main() {
    if std::env::var_os("CODEX_HALO_BUILD_SIDECAR").is_none() {
        tauri_build::build();
    }
}
