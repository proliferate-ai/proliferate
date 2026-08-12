use std::{borrow::Cow, collections::BTreeMap, sync::OnceLock};

use proliferate_diagnostics_protocol::v1::{
    limits::{
        CURRENT_SCHEMA_VERSION, MAX_ARGUMENTS, MAX_ARGUMENT_DEPTH, MAX_ARGUMENT_LIST_ITEMS,
        MAX_ARGUMENT_OBJECT_FIELDS, MAX_ID_BYTES, MAX_MESSAGE_BYTES, MAX_NAME_BYTES,
        MAX_RECORD_BYTES, MAX_SAFE_INTEGER, MAX_STRING_BYTES,
    },
    types::{
        ArgumentValueV1, DetailedDiagnosticV1, DetailedKindV1, PrivacyClassificationV1,
        ProducerRecordV1, RecordClassV1, RedactionClassificationV1, TypedArgumentV1,
    },
    validation::validate_producer_record,
};
use regex::Regex;

use crate::{
    DetailedDiagnosticInput, DiagnosticArgument, DiagnosticCorrelation, DiagnosticPrivacy,
    DiagnosticsComponent,
};

pub(crate) struct RecordFactory {
    component: DiagnosticsComponent,
    release: String,
    environment: String,
    producer_boot_id: String,
}

pub(crate) struct PreparedRecord {
    input: DetailedDiagnosticInput,
    operation_id: String,
}

impl RecordFactory {
    pub(crate) fn new(
        component: DiagnosticsComponent,
        release: &str,
        environment: &str,
        producer_boot_id: String,
    ) -> Result<Self, ()> {
        if !valid_short(release) || !valid_short(environment) || !valid_id(Some(&producer_boot_id))
        {
            return Err(());
        }
        Ok(Self {
            component,
            release: release.to_owned(),
            environment: environment.to_owned(),
            producer_boot_id,
        })
    }

    pub(crate) fn prepare(&self, mut input: DetailedDiagnosticInput) -> Result<PreparedRecord, ()> {
        if input.name.is_empty()
            || input.name.len() > MAX_NAME_BYTES
            || input.arguments.len() > MAX_ARGUMENTS
            || input
                .dropped_count
                .is_some_and(|value| value > MAX_SAFE_INTEGER)
            || matches!(input.kind, DetailedKindV1::Stdio) != input.stream.is_some()
            || matches!(input.kind, DetailedKindV1::Milestone) != input.milestone.is_some()
        {
            return Err(());
        }
        input.message = input
            .message
            .map(|value| redact_and_bound(value, MAX_MESSAGE_BYTES));
        input.arguments = input
            .arguments
            .into_iter()
            .filter_map(filter_argument)
            .take(MAX_ARGUMENTS)
            .collect();
        sanitize_correlation(&mut input.correlation);
        let operation_id = input
            .correlation
            .operation_id
            .clone()
            .filter(|value| valid_id(Some(value)))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        input.correlation.operation_id = Some(operation_id.clone());
        if let Some(classification) = input.error_classification.as_ref() {
            if !valid_name(classification) {
                input.error_classification = None;
            }
        }
        if let Some(milestone) = input.milestone.as_ref() {
            if !valid_name(milestone) {
                return Err(());
            }
        }
        let prepared = PreparedRecord {
            input,
            operation_id,
        };
        let probe = self.build(&prepared, 1)?;
        if serde_json::to_vec(&probe).map_err(|_| ())?.len() > MAX_RECORD_BYTES {
            return Err(());
        }
        Ok(prepared)
    }

    pub(crate) fn build(
        &self,
        prepared: &PreparedRecord,
        producer_sequence: u64,
    ) -> Result<ProducerRecordV1, ()> {
        if producer_sequence == 0 || producer_sequence > MAX_SAFE_INTEGER {
            return Err(());
        }
        let correlation = &prepared.input.correlation;
        let privacy = prepared
            .input
            .arguments
            .iter()
            .fold(prepared.input.privacy, |current, argument| {
                current.max(argument.privacy)
            });
        let record = ProducerRecordV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            source_timestamp: chrono::Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            producer_sequence,
            producer_boot_id: self.producer_boot_id.clone(),
            component: self.component.protocol_component(),
            source: self.component.protocol_source(),
            release: self.release.clone(),
            environment: self.environment.clone(),
            operation_id: prepared.operation_id.clone(),
            parent_operation_id: correlation.parent_operation_id.clone(),
            trace_id: correlation.trace_id.clone(),
            workspace_id: correlation.workspace_id.clone(),
            session_id: correlation.session_id.clone(),
            turn_id: correlation.turn_id.clone(),
            item_id: correlation.item_id.clone(),
            request_id: correlation.request_id.clone(),
            target_id: correlation.target_id.clone(),
            prompt_id: correlation.prompt_id.clone(),
            workflow_id: correlation.workflow_id.clone(),
            name: prepared.input.name.to_string(),
            severity: prepared.input.severity,
            arguments: prepared
                .input
                .arguments
                .iter()
                .map(|argument| TypedArgumentV1 {
                    name: argument.name.to_string(),
                    privacy: map_privacy(argument.privacy),
                    value: argument.value.clone(),
                })
                .collect(),
            error_classification: prepared
                .input
                .error_classification
                .as_ref()
                .map(ToString::to_string),
            record_class: RecordClassV1::Detailed,
            privacy: map_privacy(privacy),
            redaction: RedactionClassificationV1::Structural,
            detailed: Some(DetailedDiagnosticV1 {
                kind: prepared.input.kind,
                message: prepared.input.message.clone(),
                stream: prepared.input.stream,
                dropped_count: prepared.input.dropped_count,
                milestone: prepared.input.milestone.as_ref().map(ToString::to_string),
            }),
            lifecycle: None,
        };
        validate_producer_record(&record).map_err(|_| ())?;
        if serde_json::to_vec(&record).map_err(|_| ())?.len() > MAX_RECORD_BYTES {
            return Err(());
        }
        Ok(record)
    }
}

fn filter_argument(mut argument: DiagnosticArgument) -> Option<DiagnosticArgument> {
    if !valid_name(&argument.name) || secret_name(&argument.name) {
        return None;
    }
    argument.value = filter_value(argument.value, 1)?;
    Some(argument)
}

fn filter_value(value: ArgumentValueV1, depth: usize) -> Option<ArgumentValueV1> {
    if depth > MAX_ARGUMENT_DEPTH {
        return None;
    }
    match value {
        ArgumentValueV1::String(value) => Some(ArgumentValueV1::String(redact_and_bound(
            value,
            MAX_STRING_BYTES,
        ))),
        ArgumentValueV1::Enum(value) if valid_name(&value) => Some(ArgumentValueV1::Enum(value)),
        ArgumentValueV1::Integer(value) if value.unsigned_abs() <= MAX_SAFE_INTEGER => {
            Some(ArgumentValueV1::Integer(value))
        }
        ArgumentValueV1::Float(value) if value.is_finite() => Some(ArgumentValueV1::Float(value)),
        ArgumentValueV1::Boolean(value) => Some(ArgumentValueV1::Boolean(value)),
        ArgumentValueV1::List(values) => Some(ArgumentValueV1::List(
            values
                .into_iter()
                .take(MAX_ARGUMENT_LIST_ITEMS)
                .filter_map(|value| filter_value(value, depth + 1))
                .collect(),
        )),
        ArgumentValueV1::Object(values) => {
            let values: BTreeMap<_, _> = values
                .into_iter()
                .filter(|(key, _)| valid_name(key) && !secret_name(key))
                .take(MAX_ARGUMENT_OBJECT_FIELDS)
                .filter_map(|(key, value)| filter_value(value, depth + 1).map(|value| (key, value)))
                .collect();
            Some(ArgumentValueV1::Object(values))
        }
        _ => None,
    }
}

fn sanitize_correlation(correlation: &mut DiagnosticCorrelation) {
    macro_rules! sanitize {
        ($field:ident) => {
            if !valid_id(correlation.$field.as_deref())
                || correlation.$field.as_deref().is_some_and(secret_value)
            {
                correlation.$field = None;
            }
        };
    }
    sanitize!(operation_id);
    sanitize!(parent_operation_id);
    sanitize!(trace_id);
    sanitize!(workspace_id);
    sanitize!(session_id);
    sanitize!(turn_id);
    sanitize!(item_id);
    sanitize!(request_id);
    sanitize!(target_id);
    sanitize!(prompt_id);
    sanitize!(workflow_id);
}

pub(crate) fn valid_id(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.is_empty() && value.len() <= MAX_ID_BYTES)
}

fn valid_short(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_NAME_BYTES
}

pub(crate) fn valid_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value.len() <= MAX_NAME_BYTES
        && bytes.all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'_' | b':' | b'-')
        })
}

pub(crate) fn secret_name(value: &str) -> bool {
    let normalized: String = value
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    [
        "authorization",
        "authheader",
        "cookie",
        "accesstoken",
        "refreshtoken",
        "identitytoken",
        "bearertoken",
        "apikey",
        "clientsecret",
        "password",
        "passphrase",
        "privatekey",
        "signingkey",
        "environment",
        "envmap",
        "envvars",
        "envvalues",
        "rawenv",
        "keychain",
        "credential",
        "awsaccesskeyid",
        "awssecretaccesskey",
        "sessiontoken",
        "securitytoken",
        "secret",
    ]
    .iter()
    .any(|secret| normalized.contains(secret))
}

pub(crate) fn redact_and_bound(mut value: String, limit: usize) -> String {
    // Regex work is bounded independently of caller input. The look-ahead is
    // deliberately larger than every accepted secret token/key form, and an
    // unterminated private-key header is itself redacted by the closed corpus.
    let scan_limit = limit.saturating_add(8_192);
    redact_secret_crossing_cutoff(&mut value, scan_limit);
    truncate_utf8_in_place(&mut value, scan_limit);
    for regex in labeled_secret_regexes() {
        value = regex
            .replace_all(&value, "${prefix}[REDACTED]")
            .into_owned();
    }
    for regex in secret_regexes() {
        value = regex.replace_all(&value, "[REDACTED]").into_owned();
    }
    truncate_utf8(value, limit)
}

pub(crate) fn redact_secret_crossing_cutoff(value: &mut String, cutoff: usize) {
    if value.len() <= cutoff {
        return;
    }
    let mut boundary = cutoff;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    let prefix = &value[..boundary];
    let lower = prefix.to_ascii_lowercase();
    let mut crossing_start = None;
    for marker in [
        "ghp_",
        "github_pat_",
        "eyj",
        "sk-",
        "akia",
        "asia",
        "-----begin ",
        "bearer ",
        "basic ",
        "x-amz-signature=",
        "x-amz-credential=",
        "x-amz-security-token=",
        "access_token=",
        "api_key=",
    ] {
        let Some(start) = lower.rfind(marker) else {
            continue;
        };
        let suffix = &lower[start + marker.len()..];
        let still_open = match marker {
            "-----begin " => !suffix.contains("-----end "),
            "x-amz-signature="
            | "x-amz-credential="
            | "x-amz-security-token="
            | "access_token="
            | "api_key=" => !suffix
                .bytes()
                .any(|byte| byte.is_ascii_whitespace() || matches!(byte, b'&' | b'#')),
            _ => suffix.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'_' | b'-' | b'.' | b'~' | b'+' | b'/' | b'=')
            }),
        };
        if still_open {
            crossing_start =
                Some(crossing_start.map_or(start, |current: usize| current.max(start)));
        }
    }
    if let Some(start) = crossing_start {
        value.truncate(start);
        value.push_str("[REDACTED]");
    }
}

pub(crate) fn secret_value(value: &str) -> bool {
    labeled_secret_regexes()
        .iter()
        .chain(secret_regexes())
        .any(|regex| regex.is_match(value))
}

fn labeled_secret_regexes() -> &'static [Regex] {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        [
            // Header values can contain spaces, semicolons, and auth-scheme
            // metadata. Quoted JSON/debug values stop at their closing quote;
            // an unquoted header consumes only its physical log line.
            r#"(?i)(?P<prefix>^|[\s{\[(,;])["']?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)["']?\s*(?::|=)\s*(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\r\n]+)"#,
            // The closed credential vocabulary requires an exact field label
            // followed immediately by ':' or '='. This avoids substring
            // matches such as `passwordless`, `credentialed`, or `monkey`.
            r#"(?i)(?P<prefix>^|[\s{\[(,;])["']?(?:password|passphrase|client_secret|api_key|access_token|refresh_token|session_token|security_token|credential)["']?\s*(?::|=)\s*(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
            // Preserve the prior env-style protection without the old broad
            // "contains KEY/PASS" false positives: the secret word must be a
            // complete underscore-delimited suffix.
            r#"(?i)(?P<prefix>^|[\s{\[(,;])["']?(?:[a-z][a-z0-9]*_)+(?:token|key|secret|password|pass|credential)["']?\s*(?::|=)\s*(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("fixed labeled-secret regex is valid"))
        .collect()
    })
}

fn secret_regexes() -> &'static [Regex] {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        [
            r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}",
            r"(?i)(?:[?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|token|access_token|api_key)=)[^&#\s]+",
            r"(?s)-----BEGIN [^-\n]*PRIVATE KEY-----.*?(?:-----END [^-\n]*PRIVATE KEY-----|$)",
            r"\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b",
            r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
            r"\bsk-[A-Za-z0-9_-]{16,}\b",
            r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b",
            r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("fixed secret regex is valid"))
        .collect()
    })
}

fn truncate_utf8(mut value: String, limit: usize) -> String {
    const MARKER: &str = "...[truncated]";
    if value.len() <= limit {
        return value;
    }
    let target = limit.saturating_sub(MARKER.len());
    let mut boundary = target.min(value.len());
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str(MARKER);
    value
}

fn truncate_utf8_in_place(value: &mut String, limit: usize) {
    const MARKER: &str = "...[truncated]";
    if value.len() <= limit {
        return;
    }
    let target = limit.saturating_sub(MARKER.len());
    let mut boundary = target.min(value.len());
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str(MARKER);
}

fn map_privacy(value: DiagnosticPrivacy) -> PrivacyClassificationV1 {
    match value {
        DiagnosticPrivacy::Operational => PrivacyClassificationV1::Operational,
        DiagnosticPrivacy::CustomerContent => PrivacyClassificationV1::CustomerContent,
        DiagnosticPrivacy::Sensitive => PrivacyClassificationV1::Sensitive,
    }
}
