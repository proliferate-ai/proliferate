use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn new_install_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn target_fingerprint() -> String {
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());
    let home = dirs::home_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "unknown-home".to_string());
    let material = format!(
        "{}:{}:{}:{}",
        hostname,
        std::env::consts::OS,
        std::env::consts::ARCH,
        home
    );

    let digest = Sha256::digest(material.as_bytes());
    to_hex(&digest[..16])
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
