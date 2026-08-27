use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use proliferate_diagnostics_protocol::v1::limits::{
    CURRENT_SCHEMA_VERSION, MAX_BATCH_BYTES, MAX_EXPORT_BYTES,
};
use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, ExportRequestV1, ExportStreamFrameV1, HealthResponseV1, IngestBatchV1,
    IngestReceiptV1, RecordClassV1, RecordsPageV1, RecordsQueryV1, SeverityV1, TailFrameV1,
    TerminalOutcomeV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_frame, validate_export_request, validate_health, validate_ingest_receipt,
    validate_records_page, validate_records_query, validate_tail_frame,
};
use reqwest::header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use url::form_urlencoded::Serializer;
use zeroize::Zeroizing;

pub(crate) const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(1);
pub(crate) const FINITE_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_JSON_RESPONSE_BYTES: usize = 2_097_152;
const MAX_STREAM_FRAME_BYTES: usize = 1_048_576;

pub(crate) struct SecretCapability(Zeroizing<String>);

impl SecretCapability {
    /// The raw capability, exposed for exactly one consumer: the 0600
    /// connection-descriptor file the local tail reads
    /// (`descriptor_file.rs`, which documents the custody decision).
    pub(crate) fn expose_for_descriptor_file(&self) -> &str {
        self.0.as_str()
    }

    pub(crate) fn new(value: String) -> Result<Self, CollectorClientError> {
        if value.is_empty()
            || value.len() > 256
            || !value.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(CollectorClientError::Protocol);
        }
        Ok(Self(Zeroizing::new(value)))
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    fn authorization(&self) -> Result<HeaderValue, CollectorClientError> {
        let encoded = Zeroizing::new(format!("Bearer {}", self.0.as_str()));
        let mut value =
            HeaderValue::from_str(&encoded).map_err(|_| CollectorClientError::Protocol)?;
        value.set_sensitive(true);
        Ok(value)
    }
}

// Deliberately omits the capability value.
impl fmt::Debug for SecretCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretCapability([REDACTED])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollectorClientError {
    Authentication,
    Rejected,
    Unavailable,
    Deadline,
    Protocol,
}

#[derive(Clone)]
pub(crate) struct CollectorHttpClient {
    endpoint: Url,
    capability: Arc<SecretCapability>,
    client: Client,
}

impl fmt::Debug for CollectorHttpClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CollectorHttpClient")
            .field("endpoint", &"loopback")
            .finish_non_exhaustive()
    }
}

impl CollectorHttpClient {
    pub(crate) fn new(
        endpoint: &str,
        capability: Arc<SecretCapability>,
    ) -> Result<Self, CollectorClientError> {
        let endpoint = Url::parse(endpoint).map_err(|_| CollectorClientError::Protocol)?;
        if endpoint.scheme() != "http"
            || endpoint.host_str() != Some("127.0.0.1")
            || endpoint.port().is_none()
            || endpoint.path() != "/"
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(CollectorClientError::Protocol);
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(HEALTH_REQUEST_TIMEOUT)
            .build()
            .map_err(|_| CollectorClientError::Protocol)?;
        Ok(Self {
            endpoint,
            capability,
            client,
        })
    }

    pub(crate) async fn health(&self) -> Result<HealthResponseV1, CollectorClientError> {
        let value = tokio::time::timeout(HEALTH_REQUEST_TIMEOUT, async {
            let response = self
                .request(reqwest::Method::GET, "v1/health")?
                .send()
                .await
                .map_err(|_| CollectorClientError::Unavailable)?;
            decode_finite(response, MAX_JSON_RESPONSE_BYTES).await
        })
        .await
        .map_err(|_| CollectorClientError::Deadline)??;
        validate_health(&value).map_err(|_| CollectorClientError::Protocol)?;
        Ok(value)
    }

    pub(crate) async fn ingest(
        &self,
        batch: &IngestBatchV1,
    ) -> Result<IngestReceiptV1, CollectorClientError> {
        let body = serde_json::to_vec(batch).map_err(|_| CollectorClientError::Protocol)?;
        if body.len() > MAX_BATCH_BYTES {
            return Err(CollectorClientError::Rejected);
        }
        let value = tokio::time::timeout(FINITE_REQUEST_TIMEOUT, async {
            let response = self
                .request(reqwest::Method::POST, "v1/ingest")?
                .header(CONTENT_TYPE, "application/json")
                .body(body)
                .send()
                .await
                .map_err(|_| CollectorClientError::Unavailable)?;
            decode_finite(response, MAX_JSON_RESPONSE_BYTES).await
        })
        .await
        .map_err(|_| CollectorClientError::Deadline)??;
        validate_ingest_receipt(&value).map_err(|_| CollectorClientError::Protocol)?;
        let accounted = usize::from(value.accepted_count)
            .saturating_add(usize::from(value.duplicate_count))
            .saturating_add(value.rejections.len());
        let mut rejected_indices = std::collections::BTreeSet::new();
        if accounted != batch.records.len()
            || value.rejections.iter().any(|rejection| {
                usize::from(rejection.index) >= batch.records.len()
                    || !rejected_indices.insert(rejection.index)
            })
        {
            return Err(CollectorClientError::Protocol);
        }
        Ok(value)
    }

    pub(crate) async fn records(
        &self,
        query: &RecordsQueryV1,
    ) -> Result<RecordsPageV1, CollectorClientError> {
        validate_records_query(query).map_err(|_| CollectorClientError::Rejected)?;
        let path = format!("v1/records?{}", encode_records_query(query));
        let value = tokio::time::timeout(FINITE_REQUEST_TIMEOUT, async {
            let response = self
                .request(reqwest::Method::GET, &path)?
                .send()
                .await
                .map_err(|_| CollectorClientError::Unavailable)?;
            decode_finite(response, MAX_JSON_RESPONSE_BYTES).await
        })
        .await
        .map_err(|_| CollectorClientError::Deadline)??;
        validate_records_page(&value).map_err(|_| CollectorClientError::Protocol)?;
        Ok(value)
    }

    pub(crate) async fn tail(
        &self,
        after_cursor: Option<u64>,
    ) -> Result<CollectorJsonLineStream<TailFrameV1>, CollectorClientError> {
        let path = format!("v1/tail?{}", encode_tail_query(after_cursor));
        let response = tokio::time::timeout(
            FINITE_REQUEST_TIMEOUT,
            self.request(reqwest::Method::GET, &path)?.send(),
        )
        .await
        .map_err(|_| CollectorClientError::Deadline)?
        .map_err(|_| CollectorClientError::Unavailable)?;
        require_success(response).await.map(|response| {
            CollectorJsonLineStream::new(response, |frame| validate_tail_frame(frame).is_ok())
        })
    }

    pub(crate) async fn export(
        &self,
        request: &ExportRequestV1,
    ) -> Result<CollectorJsonLineStream<ExportStreamFrameV1>, CollectorClientError> {
        validate_export_request(request).map_err(|_| CollectorClientError::Rejected)?;
        let body = serde_json::to_vec(request).map_err(|_| CollectorClientError::Protocol)?;
        if body.len() as u64 > MAX_EXPORT_BYTES {
            return Err(CollectorClientError::Rejected);
        }
        let response = tokio::time::timeout(
            FINITE_REQUEST_TIMEOUT,
            self.request(reqwest::Method::POST, "v1/export")?
                .header(CONTENT_TYPE, "application/json")
                .body(body)
                .send(),
        )
        .await
        .map_err(|_| CollectorClientError::Deadline)?
        .map_err(|_| CollectorClientError::Unavailable)?;
        require_success(response).await.map(|response| {
            CollectorJsonLineStream::new(response, |frame| validate_export_frame(frame).is_ok())
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        fixed_path: &str,
    ) -> Result<reqwest::RequestBuilder, CollectorClientError> {
        let url = self
            .endpoint
            .join(fixed_path)
            .expect("fixed collector route must be valid");
        Ok(self
            .client
            .request(method, url)
            .header(AUTHORIZATION, self.capability.authorization()?))
    }
}

async fn require_success(response: Response) -> Result<Response, CollectorClientError> {
    match response.status() {
        status if status.is_success() => Ok(response),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            Err(CollectorClientError::Authentication)
        }
        status if status.is_client_error() => Err(CollectorClientError::Rejected),
        _ => Err(CollectorClientError::Unavailable),
    }
}

async fn decode_finite<T: DeserializeOwned>(
    response: Response,
    limit: usize,
) -> Result<T, CollectorClientError> {
    let mut response = require_success(response).await?;
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(CollectorClientError::Protocol);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| CollectorClientError::Unavailable)?
    {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(CollectorClientError::Protocol);
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| CollectorClientError::Protocol)
}

type BoxedValidator<T> = Box<dyn Fn(&T) -> bool + Send + Sync>;

pub(crate) struct CollectorJsonLineStream<T> {
    response: Response,
    pending: Vec<u8>,
    validator: BoxedValidator<T>,
    ended: bool,
}

impl<T> fmt::Debug for CollectorJsonLineStream<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CollectorJsonLineStream")
            .field("pending_bytes", &self.pending.len())
            .field("ended", &self.ended)
            .finish()
    }
}

impl<T> CollectorJsonLineStream<T>
where
    T: DeserializeOwned,
{
    fn new(response: Response, validator: impl Fn(&T) -> bool + Send + Sync + 'static) -> Self {
        Self {
            response,
            pending: Vec::with_capacity(4096),
            validator: Box::new(validator),
            ended: false,
        }
    }

    pub(crate) async fn next(&mut self) -> Result<Option<T>, CollectorClientError> {
        loop {
            if let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
                let mut line = self.pending.drain(..=newline).collect::<Vec<_>>();
                line.pop();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.is_empty() {
                    return Err(CollectorClientError::Protocol);
                }
                let frame =
                    serde_json::from_slice(&line).map_err(|_| CollectorClientError::Protocol)?;
                if !(self.validator)(&frame) {
                    return Err(CollectorClientError::Protocol);
                }
                return Ok(Some(frame));
            }
            if self.ended {
                if self.pending.is_empty() {
                    return Ok(None);
                }
                return Err(CollectorClientError::Protocol);
            }
            let chunk = self
                .response
                .chunk()
                .await
                .map_err(|_| CollectorClientError::Unavailable)?;
            match chunk {
                Some(chunk) => {
                    if self.pending.len().saturating_add(chunk.len()) > MAX_STREAM_FRAME_BYTES {
                        return Err(CollectorClientError::Protocol);
                    }
                    self.pending.extend_from_slice(&chunk);
                }
                None => self.ended = true,
            }
        }
    }
}

fn enum_value<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .expect("protocol enums serialize as strings")
}

pub(crate) fn encode_records_query(query: &RecordsQueryV1) -> String {
    let mut serializer = Serializer::new(String::new());
    serializer.append_pair(
        "schema_version",
        &format!(
            "{}.{}",
            query.schema_version.major, query.schema_version.minor
        ),
    );
    if let Some(value) = query.after_cursor {
        serializer.append_pair("after_cursor", &value.to_string());
    }
    serializer.append_pair("limit", &query.limit.to_string());
    let filters = &query.filters;
    if let Some(value) = &filters.source_time_from {
        serializer.append_pair("source_time_from", value);
    }
    if let Some(value) = &filters.source_time_to {
        serializer.append_pair("source_time_to", value);
    }
    append_enum_values(&mut serializer, "component", &filters.components);
    append_enum_values(&mut serializer, "record_class", &filters.record_classes);
    append_enum_values(&mut serializer, "severity", &filters.severities);
    for value in &filters.names {
        serializer.append_pair("name", value);
    }
    append_enum_values(&mut serializer, "outcome", &filters.outcomes);
    append_optional(&mut serializer, "operation_id", &filters.operation_id);
    append_optional(
        &mut serializer,
        "parent_operation_id",
        &filters.parent_operation_id,
    );
    append_optional(&mut serializer, "trace_id", &filters.trace_id);
    append_optional(&mut serializer, "workspace_id", &filters.workspace_id);
    append_optional(&mut serializer, "session_id", &filters.session_id);
    append_optional(&mut serializer, "turn_id", &filters.turn_id);
    append_optional(&mut serializer, "item_id", &filters.item_id);
    append_optional(&mut serializer, "request_id", &filters.request_id);
    append_optional(&mut serializer, "target_id", &filters.target_id);
    append_optional(&mut serializer, "prompt_id", &filters.prompt_id);
    append_optional(&mut serializer, "workflow_id", &filters.workflow_id);
    append_optional(
        &mut serializer,
        "error_classification",
        &filters.error_classification,
    );
    serializer.finish()
}

fn append_enum_values<T: serde::Serialize>(
    serializer: &mut Serializer<'_, String>,
    name: &str,
    values: &[T],
) {
    for value in values {
        serializer.append_pair(name, &enum_value(value));
    }
}

fn append_optional(serializer: &mut Serializer<'_, String>, name: &str, value: &Option<String>) {
    if let Some(value) = value {
        serializer.append_pair(name, value);
    }
}

pub(crate) fn encode_tail_query(after_cursor: Option<u64>) -> String {
    let mut serializer = Serializer::new(String::new());
    serializer.append_pair(
        "schema_version",
        &format!(
            "{}.{}",
            CURRENT_SCHEMA_VERSION.major, CURRENT_SCHEMA_VERSION.minor
        ),
    );
    if let Some(value) = after_cursor {
        serializer.append_pair("after_cursor", &value.to_string());
    }
    serializer.finish()
}

pub(crate) fn contextualize_health(
    mut health: HealthResponseV1,
    restart_count: u64,
    fallback: proliferate_diagnostics_protocol::v1::types::FallbackHealthV1,
) -> Result<HealthResponseV1, CollectorClientError> {
    health.restart_count = restart_count;
    health.fallback = fallback;
    validate_health(&health).map_err(|_| CollectorClientError::Protocol)?;
    Ok(health)
}

pub(crate) fn contextualize_export_frame(
    mut frame: ExportStreamFrameV1,
    restart_count: u64,
    fallback: proliferate_diagnostics_protocol::v1::types::FallbackHealthV1,
) -> Result<ExportStreamFrameV1, CollectorClientError> {
    if let ExportStreamFrameV1::Health { health } = &mut frame {
        *health = contextualize_health(health.clone(), restart_count, fallback)?;
    }
    validate_export_frame(&frame).map_err(|_| CollectorClientError::Protocol)?;
    Ok(frame)
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
