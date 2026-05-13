use std::fs;

#[derive(Debug, Clone)]
pub struct PlatformReport {
    pub os_kind: String,
    pub os_version: Option<String>,
    pub arch: String,
    pub distro: Option<String>,
    pub shell: Option<String>,
    pub package_managers: Vec<String>,
    pub workspace_roots: Vec<String>,
}

pub async fn probe_platform() -> PlatformReport {
    PlatformReport {
        os_kind: std::env::consts::OS.to_string(),
        os_version: os_version().await,
        arch: std::env::consts::ARCH.to_string(),
        distro: linux_distro(),
        shell: std::env::var("SHELL").ok(),
        package_managers: package_managers().await,
        workspace_roots: workspace_roots(),
    }
}

async fn os_version() -> Option<String> {
    crate::inventory::versions::run_version("uname", &["-a"]).await
}

fn linux_distro() -> Option<String> {
    let content = fs::read_to_string("/etc/os-release").ok()?;
    content
        .lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .map(|value| value.trim_matches('"').to_string())
}

async fn package_managers() -> Vec<String> {
    let mut managers = Vec::new();
    for command in ["brew", "apt", "dnf", "yum", "pacman", "npm", "pnpm", "uv"] {
        if crate::inventory::versions::command_available(command).await {
            managers.push(command.to_string());
        }
    }
    managers
}

fn workspace_roots() -> Vec<String> {
    std::env::current_dir()
        .ok()
        .map(|path| vec![path.display().to_string()])
        .unwrap_or_default()
}
