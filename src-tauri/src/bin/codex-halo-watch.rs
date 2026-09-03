use codex_halo_lib::lifecycle;

fn main() {
    let Some(config_path) = lifecycle::parse_config_path(std::env::args_os().skip(1)) else {
        return;
    };
    let _ = lifecycle::run(config_path);
}
