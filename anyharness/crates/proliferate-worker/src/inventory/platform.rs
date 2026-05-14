use std::{fs, path::Path};

pub fn shell() -> Option<String> {
    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
}

pub fn distro() -> Option<String> {
    let os_release = Path::new("/etc/os-release");
    if !os_release.exists() {
        return None;
    }
    let contents = fs::read_to_string(os_release).ok()?;
    contents
        .lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .map(|value| value.trim_matches('"').to_string())
}
