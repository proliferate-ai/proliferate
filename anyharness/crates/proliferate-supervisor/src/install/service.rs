use crate::{config::SupervisorConfig, install::layout};

pub fn systemd_user_unit(config: &SupervisorConfig) -> String {
    let fallback_bin_dir = layout::default_home().join("bin");
    format!(
        r#"[Unit]
Description=Proliferate target supervisor
After=network-online.target

[Service]
Type=simple
ExecStart={} --config {} run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
"#,
        config
            .anyharness_binary
            .parent()
            .unwrap_or(fallback_bin_dir.as_path())
            .join("proliferate-supervisor")
            .display(),
        config
            .worker_config
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("../supervisor/config.toml")
            .display()
    )
}
