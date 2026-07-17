//! The real activation health gate: bounded loopback polling of AnyHarness
//! `/health` after a restart, plus a Worker liveness check.
//!
//! This replaces the former `is_upgrade_window()` stub. The `/health` probe is
//! a minimal loopback HTTP GET over `tokio::net::TcpStream` rather than
//! `reqwest`: `reqwest` stays scoped to `update/download.rs` as the Supervisor's
//! only artifact HTTP client, and the health URL is always loopback
//! (`http://127.0.0.1:<port>/health`), so a dependency-light GET is both
//! sufficient and boundary-clean.

use std::time::Duration;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    process::Child,
    time::{sleep, timeout},
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Poll `health_url` up to `attempts` times, `delay` between tries, returning
/// `true` the first time it answers with a 2xx status. When `expected_version`
/// is provided and the response body carries a matching `version` field, the
/// version must match too (a still-starting old process that answers 2xx with
/// the prior version does not satisfy the gate); a body without a recognizable
/// version field is accepted on 2xx alone.
pub async fn anyharness_healthy(
    health_url: &str,
    expected_version: Option<&str>,
    attempts: u32,
    delay: Duration,
) -> bool {
    for attempt in 0..attempts.max(1) {
        if probe_once(health_url, expected_version).await {
            return true;
        }
        if attempt + 1 < attempts.max(1) {
            sleep(delay).await;
        }
    }
    false
}

/// Worker liveness after a restart: the child must still be running (not have
/// exited) when checked. `try_wait` is non-blocking and reaps on exit.
pub fn worker_alive(child: &mut Child) -> bool {
    matches!(child.try_wait(), Ok(None))
}

async fn probe_once(health_url: &str, expected_version: Option<&str>) -> bool {
    let Some((host_port, host, path)) = split_health_url(health_url) else {
        return false;
    };
    let Ok(Ok(mut stream)) = timeout(PROBE_TIMEOUT, TcpStream::connect(&host_port)).await else {
        return false;
    };
    let request =
        format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\nAccept: */*\r\n\r\n");
    if timeout(PROBE_TIMEOUT, stream.write_all(request.as_bytes()))
        .await
        .map(|result| result.is_err())
        .unwrap_or(true)
    {
        return false;
    }
    let mut response = Vec::new();
    // A `/health` body is tiny; a single bounded read of the status line +
    // headers/body prefix is enough to decide.
    let mut buffer = [0u8; 2048];
    loop {
        match timeout(PROBE_TIMEOUT, stream.read(&mut buffer)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(read)) => {
                response.extend_from_slice(&buffer[..read]);
                if response.len() >= 8192 {
                    break;
                }
            }
            _ => return false,
        }
    }
    evaluate_health(&response, expected_version)
}

/// Split `http://host[:port]/path` into `(host:port, host, path)`. Defaults the
/// port to 80 and the path to `/`. Only `http://` (loopback) is supported.
fn split_health_url(url: &str) -> Option<(String, String, String)> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(index) => (rest[..index].to_string(), rest[index..].to_string()),
        None => (rest.to_string(), "/".to_string()),
    };
    if authority.is_empty() {
        return None;
    }
    let host = authority
        .split(':')
        .next()
        .unwrap_or(&authority)
        .to_string();
    let host_port = if authority.contains(':') {
        authority.clone()
    } else {
        format!("{authority}:80")
    };
    Some((host_port, host, path))
}

/// Decide health from a raw HTTP response: a 2xx status line, and — when an
/// expected version is supplied and the body exposes a `version` — a matching
/// version.
fn evaluate_health(response: &[u8], expected_version: Option<&str>) -> bool {
    let text = String::from_utf8_lossy(response);
    if !status_line_is_success(&text) {
        return false;
    }
    match expected_version {
        None => true,
        Some(expected) => match body_version(&text) {
            // Body advertises a version: it must be the one we activated.
            Some(found) => found == expected,
            // No recognizable version field: accept the healthy 2xx.
            None => true,
        },
    }
}

fn status_line_is_success(text: &str) -> bool {
    let status_line = text.lines().next().unwrap_or_default();
    let mut parts = status_line.split_whitespace();
    let _http = parts.next();
    matches!(parts.next(), Some(code) if code.starts_with('2') && code.len() == 3)
}

/// Best-effort extraction of a `"version": "x.y.z"` field from a JSON `/health`
/// body without imposing a schema. Returns `None` if absent/unparseable.
fn body_version(text: &str) -> Option<String> {
    let body = text.split("\r\n\r\n").nth(1)?;
    let value: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    value
        .get("version")
        .and_then(|version| version.as_str())
        .map(|version| version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_health_url_defaults_and_parses() {
        let (host_port, host, path) =
            split_health_url("http://127.0.0.1:8457/health").expect("parse");
        assert_eq!(host_port, "127.0.0.1:8457");
        assert_eq!(host, "127.0.0.1");
        assert_eq!(path, "/health");

        let (host_port, host, path) = split_health_url("http://localhost/health").expect("parse");
        assert_eq!(host_port, "localhost:80");
        assert_eq!(host, "localhost");
        assert_eq!(path, "/health");

        assert!(split_health_url("https://127.0.0.1/health").is_none());
    }

    #[test]
    fn evaluate_health_requires_2xx() {
        assert!(evaluate_health(b"HTTP/1.1 200 OK\r\n\r\n", None));
        assert!(evaluate_health(b"HTTP/1.0 204 No Content\r\n\r\n", None));
        assert!(!evaluate_health(b"HTTP/1.1 503 Service Unavailable\r\n\r\n", None));
        assert!(!evaluate_health(b"garbage", None));
    }

    #[test]
    fn evaluate_health_matches_version_when_present() {
        let ok = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"version\":\"0.2.16\"}";
        assert!(evaluate_health(ok, Some("0.2.16")));
        assert!(!evaluate_health(ok, Some("0.2.15")));
        // 2xx without a recognizable version field is accepted.
        let no_version = b"HTTP/1.1 200 OK\r\n\r\nok";
        assert!(evaluate_health(no_version, Some("0.2.16")));
    }
}
