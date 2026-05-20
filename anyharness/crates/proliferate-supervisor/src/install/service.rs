use crate::{config::SupervisorConfig, install::layout};

pub fn systemd_user_unit(config: &SupervisorConfig) -> String {
    let fallback_bin_dir = layout::default_home().join("bin");
    let environment = systemd_environment_lines(config);
    format!(
        r#"[Unit]
Description=Proliferate target supervisor
After=network-online.target

[Service]
Type=simple
{environment}
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

fn systemd_environment_lines(config: &SupervisorConfig) -> String {
    config
        .process_env
        .iter()
        .map(|(name, value)| {
            format!(
                "Environment=\"{}={}\"\n",
                name,
                value.replace('\\', "\\\\").replace('"', "\\\"")
            )
        })
        .collect()
}
