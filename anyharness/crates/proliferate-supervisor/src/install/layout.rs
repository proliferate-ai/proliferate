use std::path::PathBuf;

pub fn default_home() -> PathBuf {
    std::env::var_os("PROLIFERATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".proliferate")))
        .unwrap_or_else(|| PathBuf::from(".proliferate"))
}
