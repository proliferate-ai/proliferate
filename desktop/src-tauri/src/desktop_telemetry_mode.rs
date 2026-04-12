use url::Url;

use crate::app_config::load_app_config_record;

const DEFAULT_HOSTED_API_BASE_URL: &str = "https://app.proliferate.com/api";
const OFFICIAL_HOSTED_API_ORIGINS: &[&str] =
    &["https://api.proliferate.com", "https://app.proliferate.com"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopTelemetryMode {
    Disabled,
    LocalDev,
    SelfManaged,
    HostedProduct,
}

fn env_flag_enabled(value: Option<&str>, default_value: bool) -> bool {
    let Some(value) = value else {
        return default_value;
    };

    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => default_value,
    }
}

fn default_api_base_url() -> String {
    option_env!("PROLIFERATE_DEFAULT_API_BASE_URL")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_HOSTED_API_BASE_URL)
        .to_string()
}

fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn get_api_origin(base_url: &str) -> String {
    match Url::parse(base_url) {
        Ok(parsed) => parsed.origin().unicode_serialization(),
        Err(_) => normalize_base_url(base_url),
    }
}

fn resolve_desktop_telemetry_mode_from_inputs(
    build_telemetry_disabled: bool,
    telemetry_disabled: bool,
    native_dev_profile: bool,
    api_base_url: Option<&str>,
) -> DesktopTelemetryMode {
    if build_telemetry_disabled || telemetry_disabled {
        return DesktopTelemetryMode::Disabled;
    }

    if native_dev_profile {
        return DesktopTelemetryMode::LocalDev;
    }

    let base_url = api_base_url
        .map(normalize_base_url)
        .unwrap_or_else(default_api_base_url);
    let api_origin = get_api_origin(&base_url);

    if OFFICIAL_HOSTED_API_ORIGINS.contains(&api_origin.as_str()) {
        DesktopTelemetryMode::HostedProduct
    } else {
        DesktopTelemetryMode::SelfManaged
    }
}

pub fn resolve_desktop_telemetry_mode() -> DesktopTelemetryMode {
    let config = load_app_config_record().unwrap_or_default();
    resolve_desktop_telemetry_mode_from_inputs(
        env_flag_enabled(option_env!("PROLIFERATE_BUILD_TELEMETRY_DISABLED"), false),
        config.telemetry_disabled,
        config.native_dev_profile,
        config.api_base_url.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_desktop_telemetry_mode_disabled_wins() {
        assert_eq!(
            resolve_desktop_telemetry_mode_from_inputs(
                false,
                true,
                false,
                Some("https://app.proliferate.com/api"),
            ),
            DesktopTelemetryMode::Disabled
        );
    }

    #[test]
    fn resolve_desktop_telemetry_mode_uses_local_dev_for_native_dev_profile() {
        assert_eq!(
            resolve_desktop_telemetry_mode_from_inputs(
                false,
                false,
                true,
                Some("https://app.proliferate.com/api"),
            ),
            DesktopTelemetryMode::LocalDev
        );
    }

    #[test]
    fn resolve_desktop_telemetry_mode_uses_hosted_product_for_first_party_origin() {
        assert_eq!(
            resolve_desktop_telemetry_mode_from_inputs(
                false,
                false,
                false,
                Some("https://app.proliferate.com/api"),
            ),
            DesktopTelemetryMode::HostedProduct
        );
    }

    #[test]
    fn resolve_desktop_telemetry_mode_uses_self_managed_for_custom_origin() {
        assert_eq!(
            resolve_desktop_telemetry_mode_from_inputs(
                false,
                false,
                false,
                Some("https://api.customer.example"),
            ),
            DesktopTelemetryMode::SelfManaged
        );
    }
}
