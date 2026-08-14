use std::fmt;
use std::io;
use std::time::Duration;

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ExportRequestV1, ExportStreamFrameV1, RecordsPageV1, RecordsQueryV1, TailFrameV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_frame, validate_export_request, validate_records_page, validate_records_query,
    validate_tail_frame,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

use super::discovery::{client_scope, peer_matches_locator, read_locator, DiagnosticsBrokerScope};
use super::protocol::{
    DiagnosticsBrokerErrorV1, DiagnosticsBrokerLocatorAddressV1, DiagnosticsBrokerPayloadV1,
    DiagnosticsBrokerRequestV1, DiagnosticsBrokerResponseV1, BROKER_PROTOCOL_VERSION,
    MAX_BROKER_REQUEST_FRAME_BYTES, MAX_BROKER_RESPONSE_FRAME_BYTES,
};

pub const CLI_BROKER_OPEN_TIMEOUT: Duration = Duration::from_secs(1);
const FINITE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticsBrokerClientError {
    classification: DiagnosticsBrokerErrorV1,
    supervisor: Option<super::protocol::DesktopDiagnosticsSupervisorStateV1>,
}

impl DiagnosticsBrokerClientError {
    pub fn classification(&self) -> DiagnosticsBrokerErrorV1 {
        self.classification
    }

    pub fn classification_name(&self) -> &'static str {
        match self.classification {
            DiagnosticsBrokerErrorV1::InvalidRequest => "invalid_request",
            DiagnosticsBrokerErrorV1::PeerUnauthorized => "peer_unauthorized",
            DiagnosticsBrokerErrorV1::StaleAppBoot => "stale_app_boot",
            DiagnosticsBrokerErrorV1::BrokerBusy => "broker_busy",
            DiagnosticsBrokerErrorV1::BrokerShuttingDown => "broker_shutting_down",
            DiagnosticsBrokerErrorV1::CollectorUnavailable => "collector_unavailable",
            DiagnosticsBrokerErrorV1::CollectorReplaced => "collector_replaced",
            DiagnosticsBrokerErrorV1::CollectorRejected => "collector_rejected",
            DiagnosticsBrokerErrorV1::DeadlineExceeded => "deadline_exceeded",
            DiagnosticsBrokerErrorV1::Cancelled => "cancelled",
            DiagnosticsBrokerErrorV1::ProtocolError => "protocol_error",
            DiagnosticsBrokerErrorV1::InternalError => "internal_error",
        }
    }

    pub fn supervisor_state(
        &self,
    ) -> Option<&super::protocol::DesktopDiagnosticsSupervisorStateV1> {
        self.supervisor.as_ref()
    }

    fn new(classification: DiagnosticsBrokerErrorV1) -> Self {
        Self {
            classification,
            supervisor: None,
        }
    }

    fn from_response(
        classification: DiagnosticsBrokerErrorV1,
        supervisor: Option<super::protocol::DesktopDiagnosticsSupervisorStateV1>,
    ) -> Self {
        Self {
            classification,
            supervisor,
        }
    }
}

impl fmt::Display for DiagnosticsBrokerClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.classification_name())
    }
}

impl std::error::Error for DiagnosticsBrokerClientError {}

#[derive(Debug, Clone)]
pub struct DiagnosticsBrokerClient {
    profile: Option<String>,
    #[cfg(test)]
    scope: Option<DiagnosticsBrokerScope>,
}

impl DiagnosticsBrokerClient {
    pub fn new(profile: Option<String>) -> Self {
        Self {
            profile,
            #[cfg(test)]
            scope: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn for_scope(scope: DiagnosticsBrokerScope) -> Self {
        Self {
            profile: None,
            scope: Some(scope),
        }
    }

    pub async fn health(&self) -> Result<serde_json::Value, DiagnosticsBrokerClientError> {
        let (mut stream, request_id, app_boot_id) = self
            .open(
                |app_boot_id, request_id| DiagnosticsBrokerRequestV1::Health {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                    app_boot_id,
                    request_id,
                },
            )
            .await?;
        match read_finite_payload(&mut stream, &app_boot_id, &request_id).await? {
            DiagnosticsBrokerPayloadV1::Health(health) => {
                serde_json::to_value(health).map_err(|_| {
                    DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::ProtocolError)
                })
            }
            _ => Err(DiagnosticsBrokerClientError::new(
                DiagnosticsBrokerErrorV1::ProtocolError,
            )),
        }
    }

    pub async fn records(
        &self,
        request: RecordsQueryV1,
    ) -> Result<RecordsPageV1, DiagnosticsBrokerClientError> {
        validate_records_query(&request).map_err(|_| {
            DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::InvalidRequest)
        })?;
        let (mut stream, request_id, app_boot_id) = self
            .open(
                move |app_boot_id, request_id| DiagnosticsBrokerRequestV1::Records {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                    app_boot_id,
                    request_id,
                    request,
                },
            )
            .await?;
        match read_finite_payload(&mut stream, &app_boot_id, &request_id).await? {
            DiagnosticsBrokerPayloadV1::Records(page) if validate_records_page(&page).is_ok() => {
                Ok(page)
            }
            _ => Err(DiagnosticsBrokerClientError::new(
                DiagnosticsBrokerErrorV1::ProtocolError,
            )),
        }
    }

    pub async fn tail(
        &self,
        after_cursor: Option<u64>,
    ) -> Result<DiagnosticsBrokerTailStream, DiagnosticsBrokerClientError> {
        let (stream, request_id, app_boot_id) = self
            .open(
                move |app_boot_id, request_id| DiagnosticsBrokerRequestV1::Tail {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                    app_boot_id,
                    request_id,
                    schema_version: CURRENT_SCHEMA_VERSION,
                    after_cursor,
                },
            )
            .await?;
        Ok(DiagnosticsBrokerTailStream(DiagnosticsBrokerStream {
            stream,
            app_boot_id,
            request_id,
            ended: false,
        }))
    }

    pub async fn export(
        &self,
        request: ExportRequestV1,
    ) -> Result<DiagnosticsBrokerExportStream, DiagnosticsBrokerClientError> {
        validate_export_request(&request).map_err(|_| {
            DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::InvalidRequest)
        })?;
        let (stream, request_id, app_boot_id) = self
            .open(
                move |app_boot_id, request_id| DiagnosticsBrokerRequestV1::Export {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                    app_boot_id,
                    request_id,
                    request,
                },
            )
            .await?;
        Ok(DiagnosticsBrokerExportStream(DiagnosticsBrokerStream {
            stream,
            app_boot_id,
            request_id,
            ended: false,
        }))
    }

    async fn open(
        &self,
        make_request: impl FnOnce(String, String) -> DiagnosticsBrokerRequestV1,
    ) -> Result<(UnixStream, String, String), DiagnosticsBrokerClientError> {
        tokio::time::timeout(CLI_BROKER_OPEN_TIMEOUT, async {
            let scope = self.resolve_scope().map_err(|_| {
                DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::ProtocolError)
            })?;
            let locator = read_locator(&scope).map_err(|_| {
                DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::ProtocolError)
            })?;
            let socket_path = match &locator.locator {
                DiagnosticsBrokerLocatorAddressV1::UnixStream { path } => path,
            };
            let mut stream = UnixStream::connect(socket_path).await.map_err(|_| {
                DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::CollectorUnavailable)
            })?;
            let credentials = stream.peer_cred().map_err(|_| {
                DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::PeerUnauthorized)
            })?;
            if !peer_matches_locator(credentials.uid(), credentials.pid(), locator.pid) {
                return Err(DiagnosticsBrokerClientError::new(
                    DiagnosticsBrokerErrorV1::PeerUnauthorized,
                ));
            }
            let request_id = uuid::Uuid::new_v4().to_string();
            let request = make_request(locator.app_boot_id.clone(), request_id.clone());
            write_request(&mut stream, &request).await?;
            let response = read_response(&mut stream).await?;
            verify_response(&response, &locator.app_boot_id, &request_id)?;
            match response {
                DiagnosticsBrokerResponseV1::Accepted { .. } => {
                    Ok((stream, request_id, locator.app_boot_id))
                }
                DiagnosticsBrokerResponseV1::Error {
                    classification,
                    supervisor,
                    ..
                } => Err(DiagnosticsBrokerClientError::from_response(
                    classification,
                    supervisor,
                )),
                _ => Err(DiagnosticsBrokerClientError::new(
                    DiagnosticsBrokerErrorV1::ProtocolError,
                )),
            }
        })
        .await
        .map_err(|_| {
            DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::DeadlineExceeded)
        })?
    }

    fn resolve_scope(&self) -> Result<DiagnosticsBrokerScope, super::discovery::DiscoveryError> {
        #[cfg(test)]
        if let Some(scope) = &self.scope {
            return Ok(scope.clone());
        }
        client_scope(self.profile.as_deref())
    }
}

pub struct DiagnosticsBrokerTailStream(DiagnosticsBrokerStream);

impl DiagnosticsBrokerTailStream {
    pub async fn next(&mut self) -> Result<Option<TailFrameV1>, DiagnosticsBrokerClientError> {
        match self.0.next_payload().await? {
            Some(DiagnosticsBrokerPayloadV1::Tail(frame))
                if validate_tail_frame(&frame).is_ok() =>
            {
                Ok(Some(frame))
            }
            None => Ok(None),
            _ => Err(DiagnosticsBrokerClientError::new(
                DiagnosticsBrokerErrorV1::ProtocolError,
            )),
        }
    }
}

pub struct DiagnosticsBrokerExportStream(DiagnosticsBrokerStream);

impl DiagnosticsBrokerExportStream {
    pub async fn next(
        &mut self,
    ) -> Result<Option<ExportStreamFrameV1>, DiagnosticsBrokerClientError> {
        match self.0.next_payload().await? {
            Some(DiagnosticsBrokerPayloadV1::Export(frame))
                if validate_export_frame(&frame).is_ok() =>
            {
                Ok(Some(frame))
            }
            None => Ok(None),
            _ => Err(DiagnosticsBrokerClientError::new(
                DiagnosticsBrokerErrorV1::ProtocolError,
            )),
        }
    }
}

struct DiagnosticsBrokerStream {
    stream: UnixStream,
    app_boot_id: String,
    request_id: String,
    ended: bool,
}

impl DiagnosticsBrokerStream {
    async fn next_payload(
        &mut self,
    ) -> Result<Option<DiagnosticsBrokerPayloadV1>, DiagnosticsBrokerClientError> {
        if self.ended {
            return Ok(None);
        }
        let response = read_response(&mut self.stream).await?;
        verify_response(&response, &self.app_boot_id, &self.request_id)?;
        match response {
            DiagnosticsBrokerResponseV1::Payload { value, .. } => Ok(Some(value)),
            DiagnosticsBrokerResponseV1::End { .. } => {
                self.ended = true;
                Ok(None)
            }
            DiagnosticsBrokerResponseV1::Error {
                classification,
                supervisor,
                ..
            } => {
                self.ended = true;
                Err(DiagnosticsBrokerClientError::from_response(
                    classification,
                    supervisor,
                ))
            }
            DiagnosticsBrokerResponseV1::Accepted { .. } => Err(DiagnosticsBrokerClientError::new(
                DiagnosticsBrokerErrorV1::ProtocolError,
            )),
        }
    }
}

async fn read_finite_payload(
    stream: &mut UnixStream,
    app_boot_id: &str,
    request_id: &str,
) -> Result<DiagnosticsBrokerPayloadV1, DiagnosticsBrokerClientError> {
    tokio::time::timeout(FINITE_RESPONSE_TIMEOUT, async {
        let payload = match read_response(stream).await? {
            response @ DiagnosticsBrokerResponseV1::Payload { .. } => {
                verify_response(&response, app_boot_id, request_id)?;
                match response {
                    DiagnosticsBrokerResponseV1::Payload { value, .. } => value,
                    _ => unreachable!(),
                }
            }
            response @ DiagnosticsBrokerResponseV1::Error { .. } => {
                verify_response(&response, app_boot_id, request_id)?;
                match response {
                    DiagnosticsBrokerResponseV1::Error {
                        classification,
                        supervisor,
                        ..
                    } => {
                        return Err(DiagnosticsBrokerClientError::from_response(
                            classification,
                            supervisor,
                        ));
                    }
                    _ => unreachable!(),
                }
            }
            _ => {
                return Err(DiagnosticsBrokerClientError::new(
                    DiagnosticsBrokerErrorV1::ProtocolError,
                ));
            }
        };
        let end = read_response(stream).await?;
        verify_response(&end, app_boot_id, request_id)?;
        if !matches!(end, DiagnosticsBrokerResponseV1::End { .. }) {
            return Err(DiagnosticsBrokerClientError::new(
                DiagnosticsBrokerErrorV1::ProtocolError,
            ));
        }
        Ok(payload)
    })
    .await
    .map_err(|_| DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::DeadlineExceeded))?
}

async fn write_request(
    stream: &mut UnixStream,
    request: &DiagnosticsBrokerRequestV1,
) -> Result<(), DiagnosticsBrokerClientError> {
    let bytes = serde_json::to_vec(request)
        .map_err(|_| DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::ProtocolError))?;
    if bytes.is_empty() || bytes.len() > MAX_BROKER_REQUEST_FRAME_BYTES {
        return Err(DiagnosticsBrokerClientError::new(
            DiagnosticsBrokerErrorV1::InvalidRequest,
        ));
    }
    stream
        .write_u32(bytes.len() as u32)
        .await
        .map_err(io_error)?;
    stream.write_all(&bytes).await.map_err(io_error)?;
    stream.flush().await.map_err(io_error)
}

async fn read_response(
    stream: &mut UnixStream,
) -> Result<DiagnosticsBrokerResponseV1, DiagnosticsBrokerClientError> {
    let length = stream.read_u32().await.map_err(io_error)? as usize;
    if length == 0 || length > MAX_BROKER_RESPONSE_FRAME_BYTES {
        return Err(DiagnosticsBrokerClientError::new(
            DiagnosticsBrokerErrorV1::ProtocolError,
        ));
    }
    let mut bytes = vec![0_u8; length];
    stream.read_exact(&mut bytes).await.map_err(io_error)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::ProtocolError))?;
    let response: DiagnosticsBrokerResponseV1 = serde_json::from_value(value.clone())
        .map_err(|_| DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::ProtocolError))?;
    if serde_json::to_value(&response).ok().as_ref() != Some(&value) {
        return Err(DiagnosticsBrokerClientError::new(
            DiagnosticsBrokerErrorV1::ProtocolError,
        ));
    }
    Ok(response)
}

fn verify_response(
    response: &DiagnosticsBrokerResponseV1,
    app_boot_id: &str,
    request_id: &str,
) -> Result<(), DiagnosticsBrokerClientError> {
    let (version, response_boot, response_request) = response.identities();
    if version != BROKER_PROTOCOL_VERSION
        || response_boot != app_boot_id
        || response_request != request_id
    {
        return Err(DiagnosticsBrokerClientError::new(
            DiagnosticsBrokerErrorV1::ProtocolError,
        ));
    }
    Ok(())
}

fn io_error(_error: io::Error) -> DiagnosticsBrokerClientError {
    DiagnosticsBrokerClientError::new(DiagnosticsBrokerErrorV1::CollectorUnavailable)
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
