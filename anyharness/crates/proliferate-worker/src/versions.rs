const SUPERVISOR_VERSION_ENV: &str = "PROLIFERATE_SUPERVISOR_VERSION";

pub fn worker_version() -> Option<String> {
    Some(env!("CARGO_PKG_VERSION").to_string())
}

pub fn supervisor_version() -> Option<String> {
    std::env::var(SUPERVISOR_VERSION_ENV)
        .ok()
        .and_then(|version| normalize_configured_version(&version))
}

pub fn supervisor_version_or_configured(configured: &Option<String>) -> Option<String> {
    supervisor_version().or_else(|| configured.as_deref().and_then(normalize_configured_version))
}

fn normalize_configured_version(version: &str) -> Option<String> {
    let version = version.trim();
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_configured_version, supervisor_version_or_configured};

    #[test]
    fn normalize_configured_version_trims_and_rejects_empty_values() {
        assert_eq!(
            normalize_configured_version(" 0.2.0 "),
            Some("0.2.0".to_string())
        );
        assert_eq!(normalize_configured_version("   "), None);
    }

    #[test]
    fn supervisor_version_falls_back_to_configured_value() {
        let configured = Some(" 0.3.0 ".to_string());
        if std::env::var("PROLIFERATE_SUPERVISOR_VERSION").is_err() {
            assert_eq!(
                supervisor_version_or_configured(&configured),
                Some("0.3.0".to_string())
            );
        }
    }
}
