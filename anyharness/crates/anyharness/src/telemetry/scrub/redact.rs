use sentry::protocol::Value;

use super::super::RUNTIME_ENV_TAG;
use super::{MAX_CORRELATION_ID_BYTES, MAX_CORRELATION_SLUG_BYTES, MAX_DIAGNOSTIC_STRING_BYTES};

/// Incident and correlation keys whose values are bounded identifiers or
/// finite catalog vocabulary. These remain visible even when their names
/// contain a normally-sensitive word such as `prompt` or `fingerprint`.
const SAFE_DIAGNOSTIC_KEYS: &[&str] = &[
    "incident_id",
    "error_code",
    "error_kind",
    "fingerprint",
    "request_id",
    "flow_id",
    "flow_kind",
    "flow_source",
    "prompt_id",
    "measurement_operation_id",
    "workspace_id",
    "attempted_session_id",
    "session_id",
    "agent_kind",
    "requested_model",
    "canonical_model",
    "active_contexts",
    "required_contexts",
    "catalog_version",
    "selection_outcome",
    "effective_model",
    "effective_route",
    "surface",
    "telemetry_mode",
    RUNTIME_ENV_TAG,
    "org_id",
    "sandbox_id",
    "user_id",
    "target_id",
];

fn diagnostic_key_leaf(key: &str) -> String {
    let normalized = key.to_ascii_lowercase();
    normalized
        .rsplit(|character| matches!(character, ':' | '.'))
        .next()
        .unwrap_or(normalized.as_str())
        .to_string()
}

pub(super) fn explicitly_safe_key(key: &str) -> bool {
    SAFE_DIAGNOSTIC_KEYS.contains(&diagnostic_key_leaf(key).as_str())
}

pub(super) fn safe_value_for_key(key: &str, value: &Value) -> bool {
    match value {
        Value::String(value) => safe_string_value_for_key(key, value),
        _ => !matches!(
            diagnostic_key_leaf(key).as_str(),
            "request_id"
                | "flow_id"
                | "prompt_id"
                | "measurement_operation_id"
                | "flow_kind"
                | "flow_source"
        ),
    }
}

pub(super) fn safe_string_value_for_key(key: &str, value: &str) -> bool {
    let leaf = diagnostic_key_leaf(key);
    match leaf.as_str() {
        "request_id" | "flow_id" | "prompt_id" => {
            safe_ascii_identifier(value, MAX_CORRELATION_ID_BYTES, true)
        }
        "measurement_operation_id" => {
            value.starts_with("mop_")
                && safe_ascii_identifier(value, MAX_CORRELATION_ID_BYTES, true)
        }
        "flow_kind" | "flow_source" => {
            safe_ascii_identifier(value, MAX_CORRELATION_SLUG_BYTES, false)
        }
        _ => true,
    }
}

fn safe_ascii_identifier(value: &str, max_bytes: usize, allow_colon: bool) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !looks_like_secret(value)
        && redact_sensitive_text(value) == value
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'_' | b'-' | b'.')
                || (allow_colon && byte == b':')
        })
}

fn looks_like_secret(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "sk-",
        "sk_",
        "ghp_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "npm_",
        "akia",
        "bearer",
        "basic",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix))
}

fn scrub_text(value: &str) -> String {
    redact_absolute_paths(&strip_query_segments(&redact_sensitive_text(value)))
}

pub(super) fn scrub_bounded_text(value: &str) -> String {
    let mut scrubbed = scrub_text(value);
    if scrubbed.len() > MAX_DIAGNOSTIC_STRING_BYTES {
        let mut end = MAX_DIAGNOSTIC_STRING_BYTES;
        while !scrubbed.is_char_boundary(end) {
            end -= 1;
        }
        scrubbed.truncate(end);
    }
    scrubbed
}

fn redact_sensitive_text(value: &str) -> String {
    let without_pem = redact_pem_blocks(value);
    let without_auth = redact_auth_schemes(&without_pem);
    let without_assignments = redact_secret_assignments(&without_auth);
    redact_prefixed_secrets(&without_assignments)
}

fn redact_pem_blocks(value: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some(index) = find_ascii_case_insensitive(remaining, "-----begin ") {
        output.push_str(&remaining[..index]);
        output.push_str("[redacted-secret]");
        let block = &remaining[index..];
        let end = find_ascii_case_insensitive(block, "-----end ")
            .and_then(|end_marker| {
                block[end_marker + "-----end ".len()..]
                    .find("-----")
                    .map(|suffix| end_marker + "-----end ".len() + suffix + "-----".len())
            })
            .unwrap_or(block.len());
        remaining = &block[end..];
    }
    output.push_str(remaining);
    output
}

fn redact_auth_schemes(value: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some((index, marker_len)) = earliest_ascii_marker(remaining, &["bearer", "basic"]) {
        let mut credential_start = index + marker_len;
        if !token_boundary_before(remaining, index)
            || !remaining[credential_start..]
                .chars()
                .next()
                .is_some_and(char::is_whitespace)
        {
            output.push_str(&remaining[..index + marker_len]);
            remaining = &remaining[index + marker_len..];
            continue;
        }
        while let Some(character) = remaining[credential_start..].chars().next() {
            if character.is_whitespace() || matches!(character, '\'' | '"') {
                credential_start += character.len_utf8();
            } else {
                break;
            }
        }
        output.push_str(&remaining[..index]);
        output.push_str("[redacted-token]");
        let credential_end = secret_token_end(remaining, credential_start);
        remaining = &remaining[credential_end..];
    }
    output.push_str(remaining);
    output
}

fn redact_secret_assignments(value: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some((start, end)) = find_secret_assignment(remaining) {
        output.push_str(&remaining[..start]);
        output.push_str("[redacted-secret]");
        remaining = &remaining[end..];
    }
    output.push_str(remaining);
    output
}

fn find_secret_assignment(value: &str) -> Option<(usize, usize)> {
    const KEYS: &[&str] = &[
        "authorization",
        "access_token",
        "access-token",
        "refresh_token",
        "refresh-token",
        "auth_token",
        "auth-token",
        "api_key",
        "api-key",
        "apikey",
        "client_secret",
        "client-secret",
        "private_key",
        "private-key",
        "token",
        "key",
        "secret",
        "password",
        "credential",
    ];
    let normalized = value.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for (index, _) in value.char_indices() {
        if !token_boundary_before(value, index) {
            continue;
        }
        for key in KEYS {
            if !normalized[index..].starts_with(key) {
                continue;
            }
            let mut cursor = index + key.len();
            if matches!(normalized[cursor..].chars().next(), Some('\'' | '"')) {
                cursor += 1;
            }
            while let Some(character) = normalized[cursor..].chars().next() {
                if character.is_whitespace() {
                    cursor += character.len_utf8();
                } else {
                    break;
                }
            }
            let Some(delimiter) = normalized[cursor..].chars().next() else {
                continue;
            };
            if !matches!(delimiter, '=' | ':') {
                continue;
            }
            cursor += delimiter.len_utf8();
            while let Some(character) = normalized[cursor..].chars().next() {
                if character.is_whitespace() || matches!(character, '\'' | '"') {
                    cursor += character.len_utf8();
                } else {
                    break;
                }
            }
            if cursor >= value.len() {
                continue;
            }
            let end = secret_token_end(value, cursor);
            if end > cursor && best.map_or(true, |(best_start, _)| index < best_start) {
                best = Some((index, end));
            }
        }
    }
    best
}

fn redact_prefixed_secrets(value: &str) -> String {
    const PREFIXES: &[&str] = &[
        "github_pat_",
        "ghp_",
        "xoxb-",
        "xoxp-",
        "npm_",
        "sk-",
        "sk_",
        "akia",
        "eyj",
    ];
    let normalized = value.to_ascii_lowercase();
    let mut output = String::new();
    let mut cursor = 0;
    while cursor < value.len() {
        let found = PREFIXES
            .iter()
            .filter_map(|prefix| {
                normalized[cursor..]
                    .find(prefix)
                    .map(|offset| (cursor + offset, *prefix))
            })
            .filter(|(index, _)| token_boundary_before(value, *index))
            .min_by_key(|(index, _)| *index);
        let Some((index, prefix)) = found else {
            output.push_str(&value[cursor..]);
            break;
        };
        let end = secret_token_end(value, index);
        if end.saturating_sub(index) <= prefix.len() {
            let next = index + prefix.len();
            output.push_str(&value[cursor..next]);
            cursor = next;
            continue;
        }
        output.push_str(&value[cursor..index]);
        output.push_str("[redacted-secret]");
        cursor = end;
    }
    output
}

fn earliest_ascii_marker(value: &str, markers: &[&str]) -> Option<(usize, usize)> {
    markers
        .iter()
        .filter_map(|marker| {
            find_ascii_case_insensitive(value, marker).map(|index| (index, marker.len()))
        })
        .min_by_key(|(index, _)| *index)
}

fn find_ascii_case_insensitive(value: &str, needle: &str) -> Option<usize> {
    value
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn token_boundary_before(value: &str, index: usize) -> bool {
    index == 0
        || value[..index]
            .chars()
            .next_back()
            .is_some_and(|character| !character.is_ascii_alphanumeric())
}

fn secret_token_end(value: &str, start: usize) -> usize {
    value[start..]
        .char_indices()
        .find_map(|(offset, character)| {
            (character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | ',' | ';' | ')' | ']' | '}' | '<' | '>'
                ))
            .then_some(start + offset)
        })
        .unwrap_or(value.len())
}

fn strip_query_segments(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut output = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '?' && preceding_token_is_urlish(&output) {
            index += 1;
            while index < chars.len()
                && !chars[index].is_whitespace()
                && !matches!(chars[index], '"' | '\'' | ')' | '<' | '>')
            {
                index += 1;
            }
            continue;
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

fn preceding_token_is_urlish(value: &str) -> bool {
    let token = value
        .rsplit(|character: char| {
            character.is_whitespace() || matches!(character, '"' | '\'' | '(' | '<' | '>')
        })
        .next()
        .unwrap_or_default();
    token.contains("://")
        || token.starts_with('/')
        || token.starts_with("./")
        || token.starts_with("../")
}

fn redact_absolute_paths(value: &str) -> String {
    let mut output = String::new();
    let mut index = 0;
    while index < value.len() {
        let rest = &value[index..];
        if rest.starts_with("/Users/")
            || rest.starts_with("/home/")
            || rest.starts_with("/private/var/mobile/")
            || rest.starts_with("/var/mobile/")
            || rest.starts_with("/data/user/")
            || rest.starts_with("/data/data/")
            || starts_with_posix_absolute_path(value, index)
            || starts_with_windows_path(rest)
        {
            output.push_str("[redacted-path]");
            index += rest
                .find(|character: char| {
                    character.is_whitespace()
                        || matches!(character, '"' | '\'' | ',' | ')' | '<' | '>')
                })
                .unwrap_or(rest.len());
            continue;
        }
        let character = rest.chars().next().expect("non-empty rest");
        output.push(character);
        index += character.len_utf8();
    }
    output
}

fn starts_with_posix_absolute_path(value: &str, index: usize) -> bool {
    let rest = &value[index..];
    if !rest.starts_with('/') || rest.starts_with("//") {
        return false;
    }
    match value[..index].chars().next_back() {
        None => true,
        Some(character) => {
            character.is_whitespace()
                || matches!(character, '"' | '\'' | '(' | '=' | ',' | ':' | '<' | '>')
        }
    }
}

fn starts_with_windows_path(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(drive) = chars.next() else {
        return false;
    };
    if !drive.is_ascii_alphabetic() || chars.next() != Some(':') {
        return false;
    }
    match chars.next() {
        Some('\\') => true,
        Some('/') => chars.next() != Some('/'),
        _ => false,
    }
}
