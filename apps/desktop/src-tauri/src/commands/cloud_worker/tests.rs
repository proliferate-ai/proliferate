use std::{env, fs};

use super::write_worker_config;

#[test]
fn worker_config_uses_the_desktop_sidecar_url() {
    let root = env::temp_dir().join(format!(
        "proliferate-worker-config-{}",
        uuid::Uuid::new_v4()
    ));
    let config_path = root.join("config.toml");
    let worker_db_path = root.join("worker.sqlite3");
    let integration_gateway_home = root.join("anyharness");

    write_worker_config(
        &config_path,
        "https://app.proliferate.com/api",
        Some("enrollment-token"),
        &worker_db_path,
        &integration_gateway_home,
        "http://127.0.0.1:50746",
    )
    .expect("write worker config");

    let contents = fs::read_to_string(config_path).expect("read worker config");
    assert!(contents.contains("runtime_base_url = \"http://127.0.0.1:50746\""));
    fs::remove_dir_all(root).expect("remove temporary worker config root");
}
