const SUPERVISOR_VERSION_ENV: &str = "PROLIFERATE_SUPERVISOR_VERSION";

pub fn worker_version() -> Option<String> {
    Some(env!("CARGO_PKG_VERSION").to_string())
}

pub fn supervisor_version() -> Option<String> {
    std::env::var(SUPERVISOR_VERSION_ENV)
        .ok()
        .map(|version| version.trim().to_string())
        .filter(|version| !version.is_empty())
}
