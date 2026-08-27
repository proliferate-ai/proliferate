//! Accepted record to OTLP/HTTP JSON logs.
//!
//! The output is an `ExportLogsServiceRequest` in the OTLP JSON encoding: the
//! protobuf JSON mapping, so 64-bit integers are decimal strings, trace ids are
//! lowercase hex, and every attribute value is an `AnyValue` union. Nothing in
//! this module knows which vendor receives the payload.

use std::collections::BTreeMap;

use chrono::DateTime;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, CollectorAcceptedRecordV1, ComponentV1, DetailedKindV1, LifecycleFinalizerV1,
    LifecyclePhaseV1, MetadataPhaseV1, PrivacyClassificationV1, ProducerRecordV1, RecordClassV1,
    RedactionClassificationV1, SchemaVersionV1, SeverityV1, SourceV1, StandardStreamV1,
    TerminalOutcomeV1,
};
use serde_json::{json, Map, Value};

use super::policy::{ExportPolicy, EXPORT_POLICY};

const SCOPE_NAME: &str = "proliferate.diagnostics";
const TRACE_ID_HEX_LENGTH: usize = 32;

/// One resource stream: a producer boot of one component at one release.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct ResourceKey {
    component: ComponentV1,
    producer_boot_id: String,
    release: String,
    environment: String,
}

/// Encodes accepted records into one OTLP logs request body.
///
/// This is the second policy fence. A record the build's [`ExportPolicy`] does
/// not admit is dropped rather than encoded: `secret` under every policy,
/// plus `detailed` and anything not `operational` in a customer build. The
/// queue filter in `handle.rs` already refused those, so nothing normally
/// reaches this check; it exists so a future call site that finds another way
/// into the encoder still cannot smuggle one past. The count of what it
/// refused is returned so exporter health can report it.
pub(super) fn encode_batch(
    install_id: Option<&str>,
    records: &[CollectorAcceptedRecordV1],
) -> (Value, u64) {
    encode_batch_with_policy(EXPORT_POLICY, install_id, records)
}

/// The policy-parameterised encoder. Production always passes the compiled
/// [`EXPORT_POLICY`]; tests pass both so a default-features CI run still
/// covers the detailed encoding a dogfood build performs and still proves the
/// customer build refuses it.
pub(super) fn encode_batch_with_policy(
    policy: ExportPolicy,
    install_id: Option<&str>,
    records: &[CollectorAcceptedRecordV1],
) -> (Value, u64) {
    let dev_tag = super::dev_tag();
    let mut grouped: BTreeMap<ResourceKey, BTreeMap<SchemaVersionV1, Vec<Value>>> = BTreeMap::new();
    let mut refused = 0_u64;
    for accepted in records {
        if !policy.admits(&accepted.record) {
            refused += 1;
            continue;
        }
        let key = ResourceKey {
            component: accepted.record.component,
            producer_boot_id: accepted.record.producer_boot_id.clone(),
            release: accepted.record.release.clone(),
            environment: accepted.record.environment.clone(),
        };
        grouped
            .entry(key)
            .or_default()
            .entry(accepted.record.schema_version)
            .or_default()
            .push(log_record(policy, accepted));
    }

    let resource_logs = grouped
        .into_iter()
        .map(|(key, scopes)| {
            json!({
                "resource": { "attributes": resource_attributes(&key, dev_tag, install_id) },
                "scopeLogs": scopes
                    .into_iter()
                    .map(|(version, log_records)| json!({
                        "scope": {
                            "name": SCOPE_NAME,
                            "version": format!("{}.{}", version.major, version.minor),
                        },
                        "logRecords": log_records,
                    }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    (json!({ "resourceLogs": resource_logs }), refused)
}

fn resource_attributes(
    key: &ResourceKey,
    dev_tag: Option<&str>,
    install_id: Option<&str>,
) -> Vec<Value> {
    let mut attributes = vec![
        attribute("service.name", string_value(component_name(key.component))),
        attribute("service.version", string_value(&key.release)),
        attribute("service.instance.id", string_value(&key.producer_boot_id)),
        attribute(
            "deployment.environment.name",
            string_value(&key.environment),
        ),
        attribute("telemetry.sdk.name", string_value(SCOPE_NAME)),
    ];
    if let Some(install) = install_id {
        // The stable identity of the installation, stamped by the collector
        // from a value its host passed in. It is not a wire-protocol field, so
        // no producer can set, spoof, or omit it, and every record from one
        // install carries the same value whatever the producer boot. It is
        // what turns per-record counts into "how many installs saw this".
        //
        // Pseudonymous by construction: a locally generated UUID with no
        // account, machine, or user identity in it, and absent entirely when
        // the host has none to give.
        attributes.push(attribute("proliferate.install_id", string_value(install)));
    }
    if let Some(tag) = dev_tag {
        // Identifies whose desktop produced the record when teammates share
        // one dogfood environment. Absent unless configured.
        attributes.push(attribute("dev.user", string_value(tag)));
    }
    attributes
}

fn log_record(policy: ExportPolicy, accepted: &CollectorAcceptedRecordV1) -> Value {
    let record = &accepted.record;
    let observed = nanos(&accepted.accepted_timestamp);
    let mut log = Map::new();
    log.insert(
        "timeUnixNano".to_owned(),
        json!(nanos(&record.source_timestamp)
            .unwrap_or(observed.unwrap_or(0))
            .to_string()),
    );
    log.insert(
        "observedTimeUnixNano".to_owned(),
        json!(observed.unwrap_or(0).to_string()),
    );
    log.insert(
        "severityNumber".to_owned(),
        json!(severity_number(record.severity)),
    );
    log.insert(
        "severityText".to_owned(),
        json!(severity_text(record.severity)),
    );
    log.insert("body".to_owned(), string_value(body_text(record)));
    if let Some(trace_id) = record
        .trace_id
        .as_deref()
        .filter(|value| is_trace_id(value))
    {
        log.insert("traceId".to_owned(), json!(trace_id.to_ascii_lowercase()));
    }
    log.insert("attributes".to_owned(), json!(attributes(policy, accepted)));
    Value::Object(log)
}

/// The detailed message is the human-readable body when a producer supplied
/// one. Everything else keys off the stable record name.
fn body_text(record: &ProducerRecordV1) -> &str {
    record
        .detailed
        .as_ref()
        .and_then(|detailed| detailed.message.as_deref())
        .unwrap_or(record.name.as_str())
}

fn attributes(policy: ExportPolicy, accepted: &CollectorAcceptedRecordV1) -> Vec<Value> {
    let record = &accepted.record;
    let mut attributes = vec![
        attribute("proliferate.name", string_value(&record.name)),
        attribute(
            "proliferate.record_class",
            string_value(record_class_name(record.record_class)),
        ),
        attribute(
            "proliferate.component",
            string_value(component_name(record.component)),
        ),
        attribute(
            "proliferate.source",
            string_value(source_name(record.source)),
        ),
        // Also the resource's `service.instance.id`. Repeating it on the record
        // keeps producer identity queryable without a resource join.
        attribute(
            "proliferate.producer_boot_id",
            string_value(&record.producer_boot_id),
        ),
        attribute(
            "proliferate.privacy",
            string_value(privacy_name(record.privacy)),
        ),
        attribute(
            "proliferate.redaction",
            string_value(redaction_name(record.redaction)),
        ),
        attribute(
            "proliferate.producer_sequence",
            int_value(record.producer_sequence),
        ),
        attribute(
            "proliferate.accepted_order",
            int_value(accepted.accepted_order),
        ),
        attribute(
            "proliferate.retention_cursor",
            int_value(accepted.retention_cursor),
        ),
        attribute(
            "proliferate.operation_id",
            string_value(&record.operation_id),
        ),
    ];
    for (key, value) in [
        (
            "proliferate.parent_operation_id",
            &record.parent_operation_id,
        ),
        ("proliferate.trace_id", &record.trace_id),
        ("proliferate.workspace_id", &record.workspace_id),
        ("proliferate.session_id", &record.session_id),
        ("proliferate.turn_id", &record.turn_id),
        ("proliferate.item_id", &record.item_id),
        ("proliferate.request_id", &record.request_id),
        ("proliferate.target_id", &record.target_id),
        ("proliferate.prompt_id", &record.prompt_id),
        ("proliferate.workflow_id", &record.workflow_id),
        (
            "proliferate.error_classification",
            &record.error_classification,
        ),
    ] {
        if let Some(value) = value {
            attributes.push(attribute(key, string_value(value)));
        }
    }
    push_lifecycle_attributes(&mut attributes, record);
    push_detailed_attributes(&mut attributes, record);
    for argument in &record.arguments {
        // Ingest rejects secret-classified arguments; refuse them again rather
        // than trust the retained encoding, and in a customer build hold every
        // argument to the same `operational` bar the record itself passed.
        if !policy.admits_privacy(argument.privacy) {
            continue;
        }
        attributes.push(attribute(
            &format!("proliferate.argument.{}", argument.name),
            argument_value(&argument.value),
        ));
    }
    attributes
}

fn push_lifecycle_attributes(attributes: &mut Vec<Value>, record: &ProducerRecordV1) {
    let Some(lifecycle) = &record.lifecycle else {
        return;
    };
    attributes.push(attribute(
        "proliferate.lifecycle.phase",
        string_value(match lifecycle.phase {
            LifecyclePhaseV1::Started => "started",
            LifecyclePhaseV1::Terminal => "terminal",
        }),
    ));
    attributes.push(attribute(
        "proliferate.lifecycle.finalizer",
        string_value(match lifecycle.finalizer {
            LifecycleFinalizerV1::Producer => "producer",
            LifecycleFinalizerV1::Collector => "collector",
        }),
    ));
    if let Some(outcome) = lifecycle.outcome {
        attributes.push(attribute(
            "proliferate.lifecycle.outcome",
            string_value(outcome_name(outcome)),
        ));
    }
    if let Some(model) = &lifecycle.model {
        attributes.push(attribute(
            "proliferate.lifecycle.model.model_id",
            string_value(&model.model_id),
        ));
        push_optional_string(
            attributes,
            "proliferate.lifecycle.model.provider_kind",
            model.provider_kind.as_deref(),
        );
        push_optional_phase(attributes, "proliferate.lifecycle.model.phase", model.phase);
        for (key, value) in [
            (
                "proliferate.lifecycle.model.input_tokens",
                model.input_tokens,
            ),
            (
                "proliferate.lifecycle.model.output_tokens",
                model.output_tokens,
            ),
            ("proliferate.lifecycle.model.duration_ms", model.duration_ms),
        ] {
            if let Some(value) = value {
                attributes.push(attribute(key, int_value(value)));
            }
        }
    }
    if let Some(plugin) = &lifecycle.plugin {
        attributes.push(attribute(
            "proliferate.lifecycle.plugin.plugin_id",
            string_value(&plugin.plugin_id),
        ));
        push_optional_string(
            attributes,
            "proliferate.lifecycle.plugin.kind",
            plugin.kind.as_deref(),
        );
        push_optional_phase(
            attributes,
            "proliferate.lifecycle.plugin.phase",
            plugin.phase,
        );
        if let Some(duration_ms) = plugin.duration_ms {
            attributes.push(attribute(
                "proliferate.lifecycle.plugin.duration_ms",
                int_value(duration_ms),
            ));
        }
    }
}

fn push_detailed_attributes(attributes: &mut Vec<Value>, record: &ProducerRecordV1) {
    let Some(detailed) = &record.detailed else {
        return;
    };
    attributes.push(attribute(
        "proliferate.detailed.kind",
        string_value(detailed_kind_name(detailed.kind)),
    ));
    if let Some(stream) = detailed.stream {
        attributes.push(attribute(
            "proliferate.detailed.stream",
            string_value(match stream {
                StandardStreamV1::Stdout => "stdout",
                StandardStreamV1::Stderr => "stderr",
            }),
        ));
    }
    if let Some(dropped_count) = detailed.dropped_count {
        attributes.push(attribute(
            "proliferate.detailed.dropped_count",
            int_value(dropped_count),
        ));
    }
    push_optional_string(
        attributes,
        "proliferate.detailed.milestone",
        detailed.milestone.as_deref(),
    );
}

fn push_optional_string(attributes: &mut Vec<Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        attributes.push(attribute(key, string_value(value)));
    }
}

fn push_optional_phase(attributes: &mut Vec<Value>, key: &str, phase: Option<MetadataPhaseV1>) {
    if let Some(phase) = phase {
        attributes.push(attribute(
            key,
            string_value(match phase {
                MetadataPhaseV1::Prepare => "prepare",
                MetadataPhaseV1::Invoke => "invoke",
                MetadataPhaseV1::Stream => "stream",
                MetadataPhaseV1::Complete => "complete",
            }),
        ));
    }
}

fn attribute(key: &str, value: Value) -> Value {
    json!({ "key": key, "value": value })
}

fn string_value(value: &str) -> Value {
    json!({ "stringValue": value })
}

/// Protobuf JSON encodes 64-bit integers as decimal strings.
fn int_value(value: u64) -> Value {
    json!({ "intValue": value.to_string() })
}

fn argument_value(value: &ArgumentValueV1) -> Value {
    match value {
        ArgumentValueV1::String(value) | ArgumentValueV1::Enum(value) => string_value(value),
        ArgumentValueV1::Integer(value) => json!({ "intValue": value.to_string() }),
        ArgumentValueV1::Float(value) => json!({ "doubleValue": value }),
        ArgumentValueV1::Boolean(value) => json!({ "boolValue": value }),
        ArgumentValueV1::List(items) => json!({
            "arrayValue": { "values": items.iter().map(argument_value).collect::<Vec<_>>() },
        }),
        ArgumentValueV1::Object(fields) => json!({
            "kvlistValue": {
                "values": fields
                    .iter()
                    .map(|(key, value)| json!({ "key": key, "value": argument_value(value) }))
                    .collect::<Vec<_>>(),
            },
        }),
    }
}

fn nanos(timestamp: &str) -> Option<u64> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .and_then(|parsed| parsed.timestamp_nanos_opt())
        .and_then(|nanos| u64::try_from(nanos).ok())
}

fn is_trace_id(value: &str) -> bool {
    value.len() == TRACE_ID_HEX_LENGTH && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

const fn severity_number(severity: SeverityV1) -> u8 {
    match severity {
        SeverityV1::Trace => 1,
        SeverityV1::Debug => 5,
        SeverityV1::Info => 9,
        SeverityV1::Warn => 13,
        SeverityV1::Error => 17,
    }
}

const fn severity_text(severity: SeverityV1) -> &'static str {
    match severity {
        SeverityV1::Trace => "TRACE",
        SeverityV1::Debug => "DEBUG",
        SeverityV1::Info => "INFO",
        SeverityV1::Warn => "WARN",
        SeverityV1::Error => "ERROR",
    }
}

const fn component_name(component: ComponentV1) -> &'static str {
    match component {
        ComponentV1::DesktopRenderer => "desktop_renderer",
        ComponentV1::DesktopTauri => "desktop_tauri",
        ComponentV1::DiagnosticsCollector => "diagnostics_collector",
        ComponentV1::Anyharness => "anyharness",
        ComponentV1::DesktopWorker => "desktop_worker",
        ComponentV1::Server => "server",
    }
}

const fn source_name(source: SourceV1) -> &'static str {
    match source {
        SourceV1::Renderer => "renderer",
        SourceV1::Tauri => "tauri",
        SourceV1::Collector => "collector",
        SourceV1::Anyharness => "anyharness",
        SourceV1::Worker => "worker",
        SourceV1::Server => "server",
    }
}

const fn record_class_name(record_class: RecordClassV1) -> &'static str {
    match record_class {
        RecordClassV1::Detailed => "detailed",
        RecordClassV1::Lifecycle => "lifecycle",
    }
}

const fn privacy_name(privacy: PrivacyClassificationV1) -> &'static str {
    match privacy {
        PrivacyClassificationV1::Operational => "operational",
        PrivacyClassificationV1::CustomerContent => "customer_content",
        PrivacyClassificationV1::Sensitive => "sensitive",
        PrivacyClassificationV1::Secret => "secret",
    }
}

const fn redaction_name(redaction: RedactionClassificationV1) -> &'static str {
    match redaction {
        RedactionClassificationV1::None => "none",
        RedactionClassificationV1::Structural => "structural",
        RedactionClassificationV1::SupportExport => "support_export",
    }
}

const fn outcome_name(outcome: TerminalOutcomeV1) -> &'static str {
    match outcome {
        TerminalOutcomeV1::Succeeded => "succeeded",
        TerminalOutcomeV1::Failed => "failed",
        TerminalOutcomeV1::Cancelled => "cancelled",
        TerminalOutcomeV1::TimedOut => "timed_out",
        TerminalOutcomeV1::Abandoned => "abandoned",
        TerminalOutcomeV1::Rejected => "rejected",
        TerminalOutcomeV1::Skipped => "skipped",
    }
}

const fn detailed_kind_name(kind: DetailedKindV1) -> &'static str {
    match kind {
        DetailedKindV1::Log => "log",
        DetailedKindV1::SpanEvent => "span_event",
        DetailedKindV1::Message => "message",
        DetailedKindV1::Stdio => "stdio",
        DetailedKindV1::TokenDelta => "token_delta",
        DetailedKindV1::ItemDelta => "item_delta",
        DetailedKindV1::Heartbeat => "heartbeat",
        DetailedKindV1::Progress => "progress",
        DetailedKindV1::Transport => "transport",
        DetailedKindV1::Milestone => "milestone",
        DetailedKindV1::LossSummary => "loss_summary",
    }
}

#[cfg(test)]
#[path = "otlp_tests.rs"]
mod tests;
