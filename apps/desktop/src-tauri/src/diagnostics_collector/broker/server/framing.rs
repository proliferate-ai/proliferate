use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::{
    DiagnosticsBrokerErrorV1, DiagnosticsBrokerPayloadV1, DiagnosticsBrokerResponseV1,
    SupervisorUnavailable, BROKER_PROTOCOL_VERSION, BROKER_STREAM_FRAME_WRITE_TIMEOUT,
    MAX_BROKER_RESPONSE_FRAME_BYTES,
};

pub(super) async fn read_frame(
    reader: &mut (impl AsyncRead + Unpin),
    limit: usize,
) -> Result<Vec<u8>, io::Error> {
    let length = reader.read_u32().await? as usize;
    if length == 0 || length > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes).await?;
    Ok(bytes)
}

pub(super) async fn write_response(
    writer: &mut (impl AsyncWrite + Unpin),
    response: &DiagnosticsBrokerResponseV1,
) -> Result<(), io::Error> {
    let bytes = serde_json::to_vec(response)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "response serialization"))?;
    if bytes.is_empty() || bytes.len() > MAX_BROKER_RESPONSE_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response frame size",
        ));
    }
    tokio::time::timeout(BROKER_STREAM_FRAME_WRITE_TIMEOUT, async {
        writer.write_u32(bytes.len() as u32).await?;
        writer.write_all(&bytes).await?;
        writer.flush().await
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "response write deadline"))?
}

pub(super) async fn write_accepted(
    writer: &mut (impl AsyncWrite + Unpin),
    app_boot_id: &str,
    request_id: &str,
) -> Result<(), io::Error> {
    write_response(
        writer,
        &DiagnosticsBrokerResponseV1::Accepted {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: app_boot_id.to_string(),
            request_id: request_id.to_string(),
        },
    )
    .await
}

pub(super) async fn write_payload(
    writer: &mut (impl AsyncWrite + Unpin),
    app_boot_id: &str,
    request_id: &str,
    value: DiagnosticsBrokerPayloadV1,
) -> Result<(), io::Error> {
    write_response(
        writer,
        &DiagnosticsBrokerResponseV1::Payload {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: app_boot_id.to_string(),
            request_id: request_id.to_string(),
            value,
        },
    )
    .await
}

pub(super) async fn write_end(
    writer: &mut (impl AsyncWrite + Unpin),
    app_boot_id: &str,
    request_id: &str,
) -> Result<(), io::Error> {
    write_response(
        writer,
        &DiagnosticsBrokerResponseV1::End {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: app_boot_id.to_string(),
            request_id: request_id.to_string(),
        },
    )
    .await
}

pub(super) async fn write_error(
    writer: &mut (impl AsyncWrite + Unpin),
    app_boot_id: &str,
    request_id: &str,
    classification: DiagnosticsBrokerErrorV1,
) -> Result<(), io::Error> {
    write_response(
        writer,
        &DiagnosticsBrokerResponseV1::Error {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: app_boot_id.to_string(),
            request_id: request_id.to_string(),
            classification,
        },
    )
    .await
}

pub(super) fn map_supervisor_error(error: SupervisorUnavailable) -> DiagnosticsBrokerErrorV1 {
    match error {
        SupervisorUnavailable::Replaced => DiagnosticsBrokerErrorV1::CollectorReplaced,
        SupervisorUnavailable::CollectorRejected => DiagnosticsBrokerErrorV1::CollectorRejected,
        SupervisorUnavailable::Deadline => DiagnosticsBrokerErrorV1::DeadlineExceeded,
        SupervisorUnavailable::ShuttingDown => DiagnosticsBrokerErrorV1::BrokerShuttingDown,
        SupervisorUnavailable::Protocol => DiagnosticsBrokerErrorV1::ProtocolError,
        SupervisorUnavailable::Starting
        | SupervisorUnavailable::Unsupported
        | SupervisorUnavailable::Degraded
        | SupervisorUnavailable::Stopped => DiagnosticsBrokerErrorV1::CollectorUnavailable,
    }
}

pub(super) fn effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() }
}
