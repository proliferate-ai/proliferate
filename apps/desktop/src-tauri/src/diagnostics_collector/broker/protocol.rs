use proliferate_diagnostics_protocol::v1::types::{
    ExportRequestV1, ExportStreamFrameV1, RecordsPageV1, RecordsQueryV1, TailFrameV1,
};
use serde::{Deserialize, Serialize};

pub type DesktopDiagnosticsHealthV1 =
    crate::diagnostics_collector::supervisor::DesktopDiagnosticsHealthV1;
pub type DesktopDiagnosticsSupervisorStateV1 =
    crate::diagnostics_collector::supervisor::DesktopDiagnosticsSupervisorStateV1;
pub type CollectorLaunchKindV1 = crate::diagnostics_collector::supervisor::CollectorLaunchKindV1;

pub const BROKER_PROTOCOL_VERSION: u16 = 1;
pub const MAX_LOCATOR_BYTES: usize = 4_096;
pub const MAX_BROKER_REQUEST_FRAME_BYTES: usize = 1_048_576;
pub const MAX_BROKER_RESPONSE_FRAME_BYTES: usize = 2_097_152;
pub const MAX_BROKER_FINITE_REQUESTS: usize = 8;
pub const MAX_BROKER_TAILS: usize = 4;
pub const MAX_BROKER_EXPORTS: usize = 1;
pub const MAX_BROKER_CONNECTIONS: usize = 13;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DiagnosticsBrokerLocatorAddressV1 {
    UnixStream { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticsBrokerLocatorV1 {
    pub schema_version: u16,
    pub locator: DiagnosticsBrokerLocatorAddressV1,
    pub app_boot_id: String,
    pub pid: u32,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum DiagnosticsBrokerRequestV1 {
    Health {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
    },
    Records {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
        request: RecordsQueryV1,
    },
    Tail {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
        schema_version: proliferate_diagnostics_protocol::v1::types::SchemaVersionV1,
        #[serde(skip_serializing_if = "Option::is_none")]
        after_cursor: Option<u64>,
    },
    Export {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
        request: ExportRequestV1,
    },
}

impl DiagnosticsBrokerRequestV1 {
    pub fn protocol_version(&self) -> u16 {
        match self {
            Self::Health {
                protocol_version, ..
            }
            | Self::Records {
                protocol_version, ..
            }
            | Self::Tail {
                protocol_version, ..
            }
            | Self::Export {
                protocol_version, ..
            } => *protocol_version,
        }
    }

    pub fn app_boot_id(&self) -> &str {
        match self {
            Self::Health { app_boot_id, .. }
            | Self::Records { app_boot_id, .. }
            | Self::Tail { app_boot_id, .. }
            | Self::Export { app_boot_id, .. } => app_boot_id,
        }
    }

    pub fn request_id(&self) -> &str {
        match self {
            Self::Health { request_id, .. }
            | Self::Records { request_id, .. }
            | Self::Tail { request_id, .. }
            | Self::Export { request_id, .. } => request_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticsBrokerErrorV1 {
    InvalidRequest,
    PeerUnauthorized,
    StaleAppBoot,
    BrokerBusy,
    BrokerShuttingDown,
    CollectorUnavailable,
    CollectorReplaced,
    CollectorRejected,
    DeadlineExceeded,
    Cancelled,
    ProtocolError,
    InternalError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "payload", content = "value", rename_all = "snake_case")]
pub enum DiagnosticsBrokerPayloadV1 {
    Health(DesktopDiagnosticsHealthV1),
    Records(RecordsPageV1),
    Tail(TailFrameV1),
    Export(ExportStreamFrameV1),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case", deny_unknown_fields)]
pub enum DiagnosticsBrokerResponseV1 {
    Accepted {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
    },
    Payload {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
        value: DiagnosticsBrokerPayloadV1,
    },
    End {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
    },
    Error {
        protocol_version: u16,
        app_boot_id: String,
        request_id: String,
        classification: DiagnosticsBrokerErrorV1,
    },
}

impl DiagnosticsBrokerResponseV1 {
    pub fn identities(&self) -> (u16, &str, &str) {
        match self {
            Self::Accepted {
                protocol_version,
                app_boot_id,
                request_id,
            }
            | Self::Payload {
                protocol_version,
                app_boot_id,
                request_id,
                ..
            }
            | Self::End {
                protocol_version,
                app_boot_id,
                request_id,
            }
            | Self::Error {
                protocol_version,
                app_boot_id,
                request_id,
                ..
            } => (*protocol_version, app_boot_id, request_id),
        }
    }
}

pub(crate) fn parse_exact_request(
    bytes: &[u8],
) -> Result<DiagnosticsBrokerRequestV1, DiagnosticsBrokerErrorV1> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| DiagnosticsBrokerErrorV1::InvalidRequest)?;
    let request: DiagnosticsBrokerRequestV1 = serde_json::from_value(value.clone())
        .map_err(|_| DiagnosticsBrokerErrorV1::InvalidRequest)?;
    let canonical =
        serde_json::to_value(&request).map_err(|_| DiagnosticsBrokerErrorV1::InternalError)?;
    if canonical != value {
        return Err(DiagnosticsBrokerErrorV1::InvalidRequest);
    }
    if request.protocol_version() != BROKER_PROTOCOL_VERSION
        || uuid::Uuid::parse_str(request.app_boot_id()).is_err()
        || uuid::Uuid::parse_str(request.request_id()).is_err()
    {
        return Err(DiagnosticsBrokerErrorV1::InvalidRequest);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broker_request_rejects_unknown_nested_fields() {
        let value = serde_json::json!({
            "command": "health",
            "protocol_version": 1,
            "app_boot_id": uuid::Uuid::new_v4(),
            "request_id": uuid::Uuid::new_v4(),
            "endpoint": "http://127.0.0.1:1"
        });
        assert_eq!(
            parse_exact_request(value.to_string().as_bytes()),
            Err(DiagnosticsBrokerErrorV1::InvalidRequest)
        );
    }
}
