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
            if !valid_id(correlation.$field.as_deref()) {
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

fn secret_name(value: &str) -> bool {
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
        "keychain",
        "credential",
        "secret",
    ]
    .iter()
    .any(|secret| normalized.contains(secret))
}

fn redact_and_bound(mut value: String, limit: usize) -> String {
    for regex in secret_regexes() {
        value = regex.replace_all(&value, "[REDACTED]").into_owned();
    }
    truncate_utf8(value, limit)
}

fn secret_regexes() -> &'static [Regex] {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        [
            r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}",
            r"(?i)\b[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIAL)[A-Z0-9_]*\s*=\s*[^\s]+",
            r"(?i)(?:[?&](?:x-amz-signature|x-amz-credential|signature|sig|token|access_token|api_key)=)[^&#\s]+",
            r"(?s)-----BEGIN [^-\n]*PRIVATE KEY-----.*?-----END [^-\n]*PRIVATE KEY-----",
            r"\b[A-Za-z0-9_-]{43}\b",
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

fn map_privacy(value: DiagnosticPrivacy) -> PrivacyClassificationV1 {
    match value {
        DiagnosticPrivacy::Operational => PrivacyClassificationV1::Operational,
        DiagnosticPrivacy::CustomerContent => PrivacyClassificationV1::CustomerContent,
        DiagnosticPrivacy::Sensitive => PrivacyClassificationV1::Sensitive,
    }
}
