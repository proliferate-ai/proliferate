use std::{collections::BTreeSet, fmt, sync::Arc, time::Duration};
use tokio::time::Instant;

use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION,
    types::{IngestBatchV1, IngestReceiptV1},
    validation::validate_ingest_receipt,
};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    StatusCode, Url,
};
use zeroize::Zeroizing;

pub(super) const TRANSPORT_DEADLINE: Duration = Duration::from_millis(500);
const MAX_RECEIPT_BYTES: usize = 65_536;

struct SecretCapability(Zeroizing<String>);

impl SecretCapability {
    fn new(value: String) -> Result<Self, TransportError> {
        if value.is_empty()
            || value.len() > 256
            || !value.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(TransportError::Protocol);
        }
        Ok(Self(Zeroizing::new(value)))
    }

    fn authorization(&self) -> Result<HeaderValue, TransportError> {
        let encoded = Zeroizing::new(format!("Bearer {}", self.0.as_str()));
        let mut header = HeaderValue::from_str(&encoded).map_err(|_| TransportError::Protocol)?;
        header.set_sensitive(true);
        Ok(header)
    }
}

impl fmt::Debug for SecretCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretCapability([REDACTED])")
    }
}

pub(crate) struct CollectorClient {
    endpoint: Url,
    capability: Arc<SecretCapability>,
    client: reqwest::Client,
}

impl CollectorClient {
    pub(crate) fn new(endpoint: &str, capability: String) -> Result<Self, TransportError> {
        let endpoint = Url::parse(endpoint).map_err(|_| TransportError::Protocol)?;
        if endpoint.scheme() != "http"
            || endpoint.host_str() != Some("127.0.0.1")
            || endpoint.port().is_none()
            || endpoint.path() != "/"
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(TransportError::Protocol);
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(TRANSPORT_DEADLINE)
            .build()
            .map_err(|_| TransportError::Protocol)?;
        Ok(Self {
            endpoint,
            capability: Arc::new(SecretCapability::new(capability)?),
            client,
        })
    }

    pub(crate) async fn ingest(
        &self,
        records: Vec<proliferate_diagnostics_protocol::v1::types::ProducerRecordV1>,
        shared_deadline: Option<Instant>,
    ) -> Result<IngestReceiptV1, TransportFailure> {
        let batch = IngestBatchV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            records,
        };
        let body = serde_json::to_vec(&batch)
            .map_err(|_| TransportFailure::pre_dispatch(TransportError::Protocol))?;
        if body.len() > super::MAX_BATCH_BODY_BYTES {
            return Err(TransportFailure::pre_dispatch(TransportError::Protocol));
        }
        let request = self
            .client
            .post(
                self.endpoint
                    .join("v1/ingest")
                    .expect("fixed collector route is valid"),
            )
            .header(
                AUTHORIZATION,
                self.capability
                    .authorization()
                    .map_err(TransportFailure::pre_dispatch)?,
            )
            .header(CONTENT_TYPE, "application/json")
            .body(body);
        let deadline = transport_deadline_at(Instant::now(), shared_deadline);
        let result = tokio::time::timeout_at(deadline, async {
            let response = request
                .send()
                .await
                .map_err(|_| TransportFailure::dispatched(TransportError::Unavailable))?;
            match response.status() {
                status if status.is_success() => {}
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                    return Err(TransportFailure::dispatched(TransportError::Authentication))
                }
                status if status.is_client_error() => {
                    return Err(TransportFailure::dispatched(TransportError::Rejected))
                }
                _ => return Err(TransportFailure::dispatched(TransportError::Unavailable)),
            }
            if response
                .content_length()
                .is_some_and(|value| value > MAX_RECEIPT_BYTES as u64)
            {
                return Err(TransportFailure::dispatched(TransportError::Protocol));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|_| TransportFailure::dispatched(TransportError::Unavailable))?;
            if bytes.len() > MAX_RECEIPT_BYTES {
                return Err(TransportFailure::dispatched(TransportError::Protocol));
            }
            let receipt: IngestReceiptV1 = serde_json::from_slice(&bytes)
                .map_err(|_| TransportFailure::dispatched(TransportError::Protocol))?;
            validate_receipt(&batch, &receipt)
                .map_err(|error| TransportFailure::dispatched(error))?;
            Ok(receipt)
        })
        .await;
        result.unwrap_or_else(|_| Err(TransportFailure::dispatched(TransportError::Deadline)))
    }
}

pub(super) fn transport_deadline_at(now: Instant, shared_deadline: Option<Instant>) -> Instant {
    shared_deadline.map_or(now + TRANSPORT_DEADLINE, |deadline| {
        deadline.min(now + TRANSPORT_DEADLINE)
    })
}

fn validate_receipt(
    batch: &IngestBatchV1,
    receipt: &IngestReceiptV1,
) -> Result<(), TransportError> {
    validate_ingest_receipt(receipt).map_err(|_| TransportError::Protocol)?;
    let accounted = usize::from(receipt.accepted_count)
        .saturating_add(usize::from(receipt.duplicate_count))
        .saturating_add(receipt.rejections.len());
    let mut indexes = BTreeSet::new();
    if accounted != batch.records.len()
        || receipt.rejections.iter().any(|rejection| {
            usize::from(rejection.index) >= batch.records.len() || !indexes.insert(rejection.index)
        })
    {
        return Err(TransportError::Protocol);
    }
    match (receipt.accepted_count, &receipt.accepted_range) {
        (0, None) => {}
        (0, Some(_)) | (_, None) => return Err(TransportError::Protocol),
        (count, Some(range)) => {
            let length = range
                .last
                .checked_sub(range.first)
                .and_then(|value| value.checked_add(1))
                .ok_or(TransportError::Protocol)?;
            if length != u64::from(count) {
                return Err(TransportError::Protocol);
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TransportError {
    Authentication,
    Rejected,
    Unavailable,
    Deadline,
    Protocol,
}

pub(crate) struct TransportFailure {
    pub(crate) error: TransportError,
    pub(crate) dispatched: bool,
}

impl TransportFailure {
    fn pre_dispatch(error: TransportError) -> Self {
        Self {
            error,
            dispatched: false,
        }
    }

    pub(super) fn dispatched(error: TransportError) -> Self {
        Self {
            error,
            dispatched: true,
        }
    }
}
