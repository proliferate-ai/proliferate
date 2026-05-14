use sha2::{Digest, Sha256};

pub fn machine_fingerprint() -> String {
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());
    let raw = format!(
        "{}:{}:{}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        host
    );
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

pub fn hostname() -> Option<String> {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
}
