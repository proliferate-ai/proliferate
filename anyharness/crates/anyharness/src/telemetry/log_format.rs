//! Log output format selection (grafana-logging spec: "one record shape").
//!
//! Production log lines are read by machines (CloudWatch → Grafana), local
//! lines are read by a person. The same decision applies to every sink a
//! process installs. Mirrored in proliferate-worker and proliferate-supervisor —
//! keep the three copies identical.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogFormat {
    Text,
    Json,
}

/// Read the process-wide format decision from the environment.
pub fn log_format_from_env() -> LogFormat {
    decide(
        std::env::var("PROLIFERATE_LOG_FORMAT").ok().as_deref(),
        std::env::var("PROLIFERATE_RUNTIME_ENV").ok().as_deref(),
    )
}

/// Pure decision: an explicit `PROLIFERATE_LOG_FORMAT` (`json` | `text`) wins;
/// otherwise a non-`local` `PROLIFERATE_RUNTIME_ENV` (a cloud machine — the
/// reader is a log pipeline, not a person) selects JSON, and local stays
/// human-readable text. Unrecognized explicit values are ignored rather than
/// trusted.
pub fn decide(explicit: Option<&str>, runtime_env: Option<&str>) -> LogFormat {
    match explicit.map(str::trim) {
        Some("json") => return LogFormat::Json,
        Some("text") => return LogFormat::Text,
        _ => {}
    }
    match runtime_env.map(str::trim) {
        None | Some("") | Some("local") => LogFormat::Text,
        Some(_) => LogFormat::Json,
    }
}

#[cfg(test)]
mod tests {
    use super::{decide, LogFormat};

    #[test]
    fn local_and_unset_stay_text() {
        assert_eq!(decide(None, None), LogFormat::Text);
        assert_eq!(decide(None, Some("local")), LogFormat::Text);
        assert_eq!(decide(None, Some("")), LogFormat::Text);
        assert_eq!(decide(None, Some("  local  ")), LogFormat::Text);
    }

    #[test]
    fn cloud_runtime_env_selects_json() {
        assert_eq!(decide(None, Some("e2b")), LogFormat::Json);
        assert_eq!(decide(None, Some("production")), LogFormat::Json);
    }

    #[test]
    fn explicit_format_wins_over_runtime_env() {
        assert_eq!(decide(Some("text"), Some("e2b")), LogFormat::Text);
        assert_eq!(decide(Some("json"), Some("local")), LogFormat::Json);
        assert_eq!(decide(Some("json"), None), LogFormat::Json);
    }

    #[test]
    fn unrecognized_explicit_value_is_ignored() {
        assert_eq!(decide(Some("yaml"), None), LogFormat::Text);
        assert_eq!(decide(Some("yaml"), Some("e2b")), LogFormat::Json);
    }
}
