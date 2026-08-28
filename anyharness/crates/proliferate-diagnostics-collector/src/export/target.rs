//! Out-of-band destination configuration.
//!
//! The destination is a URL plus opaque request headers. Neither the provider
//! identity nor its credential is part of the diagnostics contract, so both
//! arrive as environment values that only an internal binary can read.

use std::fmt;

use url::Url;

pub(super) const ENDPOINT_ENV: &str = "PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT";
pub(super) const HEADERS_ENV: &str = "PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS";

const LOGS_PATH: &str = "/v1/logs";
const MAX_HEADERS: usize = 16;
const MAX_HEADER_VALUE_BYTES: usize = 4_096;

/// A parsed destination. There is no `Clone`, `Serialize`, or plain `Debug`
/// path that can move a header value anywhere but the outgoing request.
pub(super) struct ExportTarget {
    pub(super) logs_url: Url,
    pub(super) headers: Vec<(String, String)>,
}

impl fmt::Debug for ExportTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExportTarget")
            .field("logs_url", &self.logs_url.as_str())
            .field(
                "headers",
                &format_args!("{} [REDACTED]", self.headers.len()),
            )
            .finish()
    }
}

/// How the environment described the destination.
pub(super) enum TargetConfiguration {
    /// No endpoint variable: this internal binary exports nothing.
    Absent,
    Configured(ExportTarget),
    /// An endpoint was requested but could not be used. The reason is a fixed
    /// string; the offending value is never carried out of this module.
    Invalid(&'static str),
}

pub(super) fn from_environment() -> TargetConfiguration {
    let Ok(endpoint) = std::env::var(ENDPOINT_ENV) else {
        return TargetConfiguration::Absent;
    };
    if endpoint.trim().is_empty() {
        return TargetConfiguration::Absent;
    }
    let headers = std::env::var(HEADERS_ENV).unwrap_or_default();
    match parse(&endpoint, &headers) {
        Ok(target) => TargetConfiguration::Configured(target),
        Err(reason) => TargetConfiguration::Invalid(reason),
    }
}

pub(super) fn parse(endpoint: &str, headers: &str) -> Result<ExportTarget, &'static str> {
    let mut logs_url = Url::parse(endpoint.trim()).map_err(|_| "endpoint is not a URL")?;
    match logs_url.scheme() {
        "https" => {}
        // Plaintext is only for a loopback receiver, which is how the local
        // dogfood proof runs. A remote destination must be encrypted so a
        // configured credential never crosses a network in the clear.
        "http" if is_loopback_host(&logs_url) => {}
        "http" => return Err("plaintext endpoint must be loopback"),
        _ => return Err("endpoint scheme must be http or https"),
    }
    if logs_url.host_str().is_none() {
        return Err("endpoint has no host");
    }
    if !logs_url.path().ends_with(LOGS_PATH) {
        let base = logs_url.path().trim_end_matches('/').to_owned();
        logs_url.set_path(&format!("{base}{LOGS_PATH}"));
    }
    Ok(ExportTarget {
        logs_url,
        headers: parse_headers(headers)?,
    })
}

fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        None => false,
    }
}

/// `name=value` pairs separated by commas, matching the shape the OpenTelemetry
/// `OTEL_EXPORTER_OTLP_HEADERS` convention already uses.
fn parse_headers(raw: &str) -> Result<Vec<(String, String)>, &'static str> {
    let mut headers = Vec::new();
    for entry in raw.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        if headers.len() == MAX_HEADERS {
            return Err("too many headers");
        }
        let (name, value) = entry.split_once('=').ok_or("header is not name=value")?;
        let name = name.trim();
        let value = value.trim();
        if name.is_empty() || !name.bytes().all(is_header_name_byte) {
            return Err("header name is not a token");
        }
        if value.is_empty() || value.len() > MAX_HEADER_VALUE_BYTES {
            return Err("header value is empty or over limit");
        }
        if !value.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
            return Err("header value is not visible ASCII");
        }
        headers.push((name.to_ascii_lowercase(), value.to_owned()));
    }
    Ok(headers)
}

fn is_header_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_the_logs_path_once() {
        let target = parse("https://collector.example", "").expect("valid endpoint");
        assert_eq!(
            target.logs_url.as_str(),
            "https://collector.example/v1/logs"
        );
        let target = parse("https://collector.example/", "").expect("valid endpoint");
        assert_eq!(
            target.logs_url.as_str(),
            "https://collector.example/v1/logs"
        );
        let target = parse("https://collector.example/v1/logs", "").expect("valid endpoint");
        assert_eq!(
            target.logs_url.as_str(),
            "https://collector.example/v1/logs"
        );
        let target = parse("https://collector.example/proxy", "").expect("valid endpoint");
        assert_eq!(
            target.logs_url.as_str(),
            "https://collector.example/proxy/v1/logs"
        );
    }

    #[test]
    fn rejects_plaintext_to_a_remote_host_and_allows_loopback() {
        assert_eq!(
            parse("http://collector.example", "").err(),
            Some("plaintext endpoint must be loopback")
        );
        assert!(parse("http://127.0.0.1:4318", "").is_ok());
        assert!(parse("http://localhost:4318", "").is_ok());
        assert!(parse("http://[::1]:4318", "").is_ok());
    }

    #[test]
    fn rejects_endpoints_that_are_not_http_urls() {
        assert_eq!(parse("not a url", "").err(), Some("endpoint is not a URL"));
        assert_eq!(
            parse("file:///tmp/logs", "").err(),
            Some("endpoint scheme must be http or https")
        );
    }

    #[test]
    fn parses_and_lowercases_header_pairs() {
        let target = parse(
            "https://collector.example",
            " X-Team = secret-value , x-dataset=proliferate ",
        )
        .expect("valid headers");
        assert_eq!(
            target.headers,
            vec![
                ("x-team".to_owned(), "secret-value".to_owned()),
                ("x-dataset".to_owned(), "proliferate".to_owned()),
            ]
        );
    }

    #[test]
    fn rejects_malformed_headers() {
        assert_eq!(
            parse("https://collector.example", "novalue").err(),
            Some("header is not name=value")
        );
        assert_eq!(
            parse("https://collector.example", "=value").err(),
            Some("header name is not a token")
        );
        assert_eq!(
            parse("https://collector.example", "name=").err(),
            Some("header value is empty or over limit")
        );
        assert_eq!(
            parse("https://collector.example", "na me=value").err(),
            Some("header name is not a token")
        );
        let many = (0..=MAX_HEADERS)
            .map(|index| format!("h{index}=v"))
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(
            parse("https://collector.example", &many).err(),
            Some("too many headers")
        );
    }

    #[test]
    fn debug_never_prints_a_header_value() {
        let target =
            parse("https://collector.example", "x-team=secret-value").expect("valid destination");
        let rendered = format!("{target:?}");
        assert!(!rendered.contains("secret-value"), "{rendered}");
        assert!(rendered.contains("[REDACTED]"), "{rendered}");
    }
}
