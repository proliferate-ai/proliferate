use std::sync::OnceLock;

use regex::Regex;

use crate::app_config::home_dir;

fn bearer_header_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?i)(authorization\s*:\s*bearer\s+)([^\s"',;]+)"#)
            .expect("bearer header regex should be valid")
    })
}

fn bare_bearer_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)(\bbearer\s+)([A-Za-z0-9._\-/+=]+)")
            .expect("bare bearer regex should be valid")
    })
}

fn env_secret_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?i)\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET)[A-Z0-9_]*\s*[:=]\s*)([^\s"',;]+)"#)
            .expect("env secret regex should be valid")
    })
}

pub fn scrub_diagnostic_text(input: &str) -> String {
    let mut value = input.to_string();

    if let Ok(home) = home_dir() {
        let home_text = home.to_string_lossy();
        if !home_text.is_empty() {
            value = value.replace(home_text.as_ref(), "~");
        }
    }

    value = bearer_header_regex()
        .replace_all(&value, "$1[REDACTED]")
        .into_owned();
    value = bare_bearer_regex()
        .replace_all(&value, "$1[REDACTED]")
        .into_owned();
    env_secret_regex()
        .replace_all(&value, "$1[REDACTED]")
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::scrub_diagnostic_text;

    #[test]
    fn scrubs_bearer_headers_and_env_style_secrets() {
        let scrubbed = scrub_diagnostic_text(
            "Authorization: Bearer super-secret\nAPI_TOKEN=abc123\nbearer xyz789",
        );

        assert!(!scrubbed.contains("super-secret"));
        assert!(!scrubbed.contains("abc123"));
        assert!(!scrubbed.contains("xyz789"));
        assert!(scrubbed.contains("[REDACTED]"));
    }
}
