//! A strict local OTLP/HTTP logs receiver for the dogfood proof.
//!
//! It is deliberately not a permissive sink. Every request body is checked
//! against the OTLP JSON encoding rules — the protobuf JSON mapping, so 64-bit
//! fields are decimal strings, ids are lowercase hex, and every attribute value
//! is a single-variant `AnyValue` — and any deviation is recorded as a failure
//! instead of being accepted. This proves conformance to the wire format; it
//! cannot prove that a particular vendor accepts the payload.

use std::net::SocketAddrV4;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::Router;
use serde_json::Value;

pub struct ReceivedRequest {
    pub headers: Vec<(String, String)>,
    pub payload: Value,
}

#[derive(Default)]
pub struct ReceiverState {
    requests: Mutex<Vec<ReceivedRequest>>,
    violations: Mutex<Vec<String>>,
    reject: AtomicBool,
}

impl ReceiverState {
    /// Every log record the receiver has accepted, in arrival order.
    pub fn log_records(&self) -> Vec<Value> {
        self.requests
            .lock()
            .expect("receiver requests")
            .iter()
            .flat_map(|request| log_records_of(&request.payload))
            .collect()
    }

    /// Every resource-attribute set the receiver has accepted, one per
    /// resource stream per request, in arrival order.
    pub fn resource_attribute_sets(&self) -> Vec<Value> {
        self.requests
            .lock()
            .expect("receiver requests")
            .iter()
            .flat_map(|request| {
                request.payload["resourceLogs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|resource| resource["resource"]["attributes"].clone())
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    pub fn request_count(&self) -> usize {
        self.requests.lock().expect("receiver requests").len()
    }

    pub fn header_values(&self, name: &str) -> Vec<String> {
        self.requests
            .lock()
            .expect("receiver requests")
            .iter()
            .filter_map(|request| {
                request
                    .headers
                    .iter()
                    .find(|(key, _)| key == name)
                    .map(|(_, value)| value.clone())
            })
            .collect()
    }

    pub fn violations(&self) -> Vec<String> {
        self.violations.lock().expect("receiver violations").clone()
    }

    /// Makes the destination answer every further request with 500.
    pub fn start_rejecting(&self) {
        self.reject.store(true, Ordering::SeqCst);
    }
}

pub struct Receiver {
    pub endpoint: String,
    pub state: Arc<ReceiverState>,
}

pub async fn start() -> Receiver {
    let state = Arc::new(ReceiverState::default());
    let listener =
        tokio::net::TcpListener::bind(SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("receiver listener");
    let address = listener.local_addr().expect("receiver address");
    let router = Router::new()
        .route("/v1/logs", post(logs))
        .with_state(Arc::clone(&state));
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Receiver {
        endpoint: format!("http://{address}"),
        state,
    }
}

async fn logs(
    State(state): State<Arc<ReceiverState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
    if state.reject.load(Ordering::SeqCst) {
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let content_type = headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    if !content_type.starts_with("application/json") {
        state
            .violations
            .lock()
            .expect("receiver violations")
            .push(format!("content-type was {content_type}"));
        return StatusCode::BAD_REQUEST;
    }
    let Ok(payload) = serde_json::from_slice::<Value>(&body) else {
        state
            .violations
            .lock()
            .expect("receiver violations")
            .push("body was not JSON".to_owned());
        return StatusCode::BAD_REQUEST;
    };
    if let Err(violation) = validate_export_logs_service_request(&payload) {
        state
            .violations
            .lock()
            .expect("receiver violations")
            .push(violation);
        return StatusCode::BAD_REQUEST;
    }
    state
        .requests
        .lock()
        .expect("receiver requests")
        .push(ReceivedRequest {
            headers: headers
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_owned(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect(),
            payload,
        });
    StatusCode::OK
}

fn log_records_of(payload: &Value) -> Vec<Value> {
    payload["resourceLogs"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|resource| resource["scopeLogs"].as_array().into_iter().flatten())
        .flat_map(|scope| scope["logRecords"].as_array().into_iter().flatten())
        .cloned()
        .collect()
}

fn object<'a>(value: &'a Value, what: &str) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{what} is not an object"))
}

fn only_keys(
    value: &serde_json::Map<String, Value>,
    what: &str,
    allowed: &[&str],
) -> Result<(), String> {
    for key in value.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("{what} carried unknown field {key}"));
        }
    }
    Ok(())
}

fn decimal_string(value: &Value, what: &str) -> Result<(), String> {
    let text = value
        .as_str()
        .ok_or_else(|| format!("{what} must be a JSON string"))?;
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("{what} must be a decimal string, got {text}"));
    }
    Ok(())
}

fn lowercase_hex(value: &Value, what: &str, length: usize) -> Result<(), String> {
    let text = value
        .as_str()
        .ok_or_else(|| format!("{what} must be a JSON string"))?;
    if text.len() != length
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!("{what} must be {length} lowercase hex digits"));
    }
    Ok(())
}

pub fn validate_export_logs_service_request(payload: &Value) -> Result<(), String> {
    let root = object(payload, "ExportLogsServiceRequest")?;
    only_keys(root, "ExportLogsServiceRequest", &["resourceLogs"])?;
    let resource_logs = root
        .get("resourceLogs")
        .and_then(Value::as_array)
        .ok_or("resourceLogs must be an array")?;
    if resource_logs.is_empty() {
        return Err("resourceLogs must not be empty".to_owned());
    }
    for entry in resource_logs {
        validate_resource_logs(entry)?;
    }
    Ok(())
}

fn validate_resource_logs(entry: &Value) -> Result<(), String> {
    let entry = object(entry, "ResourceLogs")?;
    only_keys(
        entry,
        "ResourceLogs",
        &["resource", "scopeLogs", "schemaUrl"],
    )?;
    if let Some(resource) = entry.get("resource") {
        let resource = object(resource, "Resource")?;
        only_keys(
            resource,
            "Resource",
            &["attributes", "droppedAttributesCount"],
        )?;
        validate_attributes(resource.get("attributes"), "Resource.attributes")?;
    }
    let scope_logs = entry
        .get("scopeLogs")
        .and_then(Value::as_array)
        .ok_or("ResourceLogs.scopeLogs must be an array")?;
    for scope in scope_logs {
        validate_scope_logs(scope)?;
    }
    Ok(())
}

fn validate_scope_logs(entry: &Value) -> Result<(), String> {
    let entry = object(entry, "ScopeLogs")?;
    only_keys(entry, "ScopeLogs", &["scope", "logRecords", "schemaUrl"])?;
    if let Some(scope) = entry.get("scope") {
        let scope = object(scope, "InstrumentationScope")?;
        only_keys(
            scope,
            "InstrumentationScope",
            &["name", "version", "attributes", "droppedAttributesCount"],
        )?;
        if scope.get("name").is_some_and(|name| !name.is_string()) {
            return Err("InstrumentationScope.name must be a string".to_owned());
        }
        validate_attributes(scope.get("attributes"), "InstrumentationScope.attributes")?;
    }
    let log_records = entry
        .get("logRecords")
        .and_then(Value::as_array)
        .ok_or("ScopeLogs.logRecords must be an array")?;
    for record in log_records {
        validate_log_record(record)?;
    }
    Ok(())
}

fn validate_log_record(entry: &Value) -> Result<(), String> {
    let record = object(entry, "LogRecord")?;
    only_keys(
        record,
        "LogRecord",
        &[
            "timeUnixNano",
            "observedTimeUnixNano",
            "severityNumber",
            "severityText",
            "body",
            "attributes",
            "droppedAttributesCount",
            "flags",
            "traceId",
            "spanId",
            "eventName",
        ],
    )?;
    for field in ["timeUnixNano", "observedTimeUnixNano"] {
        if let Some(value) = record.get(field) {
            decimal_string(value, &format!("LogRecord.{field}"))?;
        }
    }
    if let Some(severity) = record.get("severityNumber") {
        let number = severity
            .as_u64()
            .ok_or("LogRecord.severityNumber must be a number")?;
        if number > 24 {
            return Err(format!("LogRecord.severityNumber {number} is out of range"));
        }
    }
    if record.get("severityText").is_some_and(|v| !v.is_string()) {
        return Err("LogRecord.severityText must be a string".to_owned());
    }
    if let Some(body) = record.get("body") {
        validate_any_value(body, "LogRecord.body")?;
    }
    if let Some(trace_id) = record.get("traceId") {
        lowercase_hex(trace_id, "LogRecord.traceId", 32)?;
    }
    if let Some(span_id) = record.get("spanId") {
        lowercase_hex(span_id, "LogRecord.spanId", 16)?;
    }
    validate_attributes(record.get("attributes"), "LogRecord.attributes")
}

fn validate_attributes(attributes: Option<&Value>, what: &str) -> Result<(), String> {
    let Some(attributes) = attributes else {
        return Ok(());
    };
    let attributes = attributes
        .as_array()
        .ok_or_else(|| format!("{what} must be an array"))?;
    for attribute in attributes {
        validate_key_value(attribute, what)?;
    }
    Ok(())
}

fn validate_key_value(entry: &Value, what: &str) -> Result<(), String> {
    let entry = object(entry, what)?;
    only_keys(entry, what, &["key", "value"])?;
    if !entry.get("key").is_some_and(Value::is_string) {
        return Err(format!("{what} entry has no string key"));
    }
    let value = entry
        .get("value")
        .ok_or_else(|| format!("{what} entry has no value"))?;
    validate_any_value(value, what)
}

fn validate_any_value(value: &Value, what: &str) -> Result<(), String> {
    let value = object(value, &format!("{what} AnyValue"))?;
    if value.len() != 1 {
        return Err(format!(
            "{what} AnyValue must set exactly one variant, got {}",
            value.len()
        ));
    }
    let (variant, inner) = value.iter().next().expect("checked single variant");
    match variant.as_str() {
        "stringValue" => inner
            .is_string()
            .then_some(())
            .ok_or_else(|| format!("{what} stringValue must be a string")),
        "boolValue" => inner
            .is_boolean()
            .then_some(())
            .ok_or_else(|| format!("{what} boolValue must be a boolean")),
        "doubleValue" => inner
            .is_number()
            .then_some(())
            .ok_or_else(|| format!("{what} doubleValue must be a number")),
        "bytesValue" => inner
            .is_string()
            .then_some(())
            .ok_or_else(|| format!("{what} bytesValue must be base64")),
        "intValue" => decimal_string(inner, &format!("{what} intValue")),
        "arrayValue" => {
            let array = object(inner, &format!("{what} arrayValue"))?;
            only_keys(array, &format!("{what} arrayValue"), &["values"])?;
            for item in array
                .get("values")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                validate_any_value(item, what)?;
            }
            Ok(())
        }
        "kvlistValue" => {
            let list = object(inner, &format!("{what} kvlistValue"))?;
            only_keys(list, &format!("{what} kvlistValue"), &["values"])?;
            for item in list
                .get("values")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                validate_key_value(item, &format!("{what} kvlistValue"))?;
            }
            Ok(())
        }
        other => Err(format!("{what} AnyValue variant {other} is not in OTLP")),
    }
}
