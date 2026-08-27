//! The Honeycomb destination the desktop hands its collector.
//!
//! The collector reads `PROLIFERATE_DIAGNOSTICS_OTLP_{ENDPOINT,HEADERS}` from
//! its environment and exports its lifecycle-class records there (collector
//! `export/target.rs`). A customer build bakes both values in at compile time
//! from the release workflow, and this module decides whether they reach the
//! collector: only in the hosted-product telemetry mode. Disabled, local-dev,
//! and self-managed modes inject nothing, which is the self-hoster's off
//! switch — a value already present in the parent environment is left alone,
//! because that is how a developer points a dogfood build at dogfood.

use crate::desktop_telemetry_mode::DesktopTelemetryMode;

pub(crate) const ENDPOINT_ENV: &str = "PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT";
pub(crate) const HEADERS_ENV: &str = "PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS";

fn baked(key: &str) -> Option<&'static str> {
    match key {
        ENDPOINT_ENV => option_env!("PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT"),
        HEADERS_ENV => option_env!("PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS"),
        _ => None,
    }
}

fn configured(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            baked(key)
                .map(str::to_owned)
                .filter(|value| !value.trim().is_empty())
        })
}

/// The environment entries to set on the collector's spawn command.
pub(crate) fn export_env(mode: DesktopTelemetryMode) -> Vec<(&'static str, String)> {
    export_env_from(mode, configured(ENDPOINT_ENV), configured(HEADERS_ENV))
}

/// Pure half of [`export_env`]: the decision given what is configured.
pub(crate) fn export_env_from(
    mode: DesktopTelemetryMode,
    endpoint: Option<String>,
    headers: Option<String>,
) -> Vec<(&'static str, String)> {
    if mode != DesktopTelemetryMode::HostedProduct {
        return Vec::new();
    }
    let Some(endpoint) = endpoint else {
        return Vec::new();
    };
    let mut env = vec![(ENDPOINT_ENV, endpoint)];
    if let Some(headers) = headers {
        env.push((HEADERS_ENV, headers));
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    fn some(value: &str) -> Option<String> {
        Some(value.to_owned())
    }

    #[test]
    fn only_the_hosted_product_mode_hands_the_destination_to_the_collector() {
        for mode in [
            DesktopTelemetryMode::Disabled,
            DesktopTelemetryMode::LocalDev,
            DesktopTelemetryMode::SelfManaged,
        ] {
            assert!(
                export_env_from(mode, some("https://api.honeycomb.io"), some("x=y")).is_empty(),
                "{mode:?} must not export"
            );
        }
        let env = export_env_from(
            DesktopTelemetryMode::HostedProduct,
            some("https://api.honeycomb.io"),
            some("x-honeycomb-team=k"),
        );
        assert_eq!(
            env,
            vec![
                (ENDPOINT_ENV, "https://api.honeycomb.io".to_owned()),
                (HEADERS_ENV, "x-honeycomb-team=k".to_owned()),
            ]
        );
    }

    #[test]
    fn a_missing_endpoint_means_no_destination_even_when_hosted() {
        assert!(export_env_from(DesktopTelemetryMode::HostedProduct, None, some("x=y")).is_empty());
        assert_eq!(
            export_env_from(DesktopTelemetryMode::HostedProduct, some("https://e"), None),
            vec![(ENDPOINT_ENV, "https://e".to_owned())]
        );
    }
}
