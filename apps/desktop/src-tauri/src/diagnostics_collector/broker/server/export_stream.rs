use std::sync::Arc;

use tokio::io::AsyncReadExt;
use tokio::net::{unix::OwnedReadHalf, UnixStream};
use tokio::sync::watch;

use crate::diagnostics_collector::supervisor::{
    DiagnosticsCollectorSupervisor, SupervisorExportLease,
};

use super::super::protocol::{DiagnosticsBrokerErrorV1, DiagnosticsBrokerPayloadV1};
use super::framing::{write_end, write_error, write_payload};

pub(super) async fn stream_export(
    stream: UnixStream,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    mut lease: SupervisorExportLease,
    mut broker_shutdown: watch::Receiver<bool>,
    app_boot_id: &str,
    request_id: &str,
) {
    let (read, mut write) = stream.into_split();
    let disconnected = caller_disconnected(read);
    tokio::pin!(disconnected);
    loop {
        if *lease.generation_changed.borrow() != lease.generation {
            let _ = write_error(
                &mut write,
                app_boot_id,
                request_id,
                DiagnosticsBrokerErrorV1::CollectorReplaced,
            )
            .await;
            return;
        }
        if *lease.shutdown.borrow() || *broker_shutdown.borrow() {
            let _ = write_error(
                &mut write,
                app_boot_id,
                request_id,
                DiagnosticsBrokerErrorV1::Cancelled,
            )
            .await;
            return;
        }
        tokio::select! {
            _ = &mut disconnected => return,
            changed = lease.generation_changed.changed() => {
                if changed.is_err() || *lease.generation_changed.borrow() != lease.generation {
                    let _ = write_error(&mut write, app_boot_id, request_id, DiagnosticsBrokerErrorV1::CollectorReplaced).await;
                    return;
                }
            }
            changed = lease.shutdown.changed() => {
                if changed.is_err() || *lease.shutdown.borrow() {
                    let _ = write_error(&mut write, app_boot_id, request_id, DiagnosticsBrokerErrorV1::Cancelled).await;
                    return;
                }
            }
            changed = broker_shutdown.changed() => {
                if changed.is_err() || *broker_shutdown.borrow() {
                    let _ = write_error(&mut write, app_boot_id, request_id, DiagnosticsBrokerErrorV1::Cancelled).await;
                    return;
                }
            }
            frame = lease.stream.next() => match frame {
                Ok(Some(frame)) => match supervisor.contextualize_export(
                    lease.generation,
                    lease.restart_count,
                    frame,
                ) {
                    Ok(frame) => {
                        if write_payload(
                            &mut write,
                            app_boot_id,
                            request_id,
                            DiagnosticsBrokerPayloadV1::Export(frame),
                        )
                        .await
                        .is_err()
                        {
                            return;
                        }
                    }
                    Err(_) => {
                        let _ = write_error(
                            &mut write,
                            app_boot_id,
                            request_id,
                            DiagnosticsBrokerErrorV1::ProtocolError,
                        )
                        .await;
                        return;
                    }
                },
                Ok(None) => {
                    let _ = write_end(&mut write, app_boot_id, request_id).await;
                    return;
                }
                Err(_) => {
                    let _ = write_error(
                        &mut write,
                        app_boot_id,
                        request_id,
                        DiagnosticsBrokerErrorV1::CollectorUnavailable,
                    )
                    .await;
                    return;
                }
            }
        }
    }
}

async fn caller_disconnected(mut read: OwnedReadHalf) {
    let mut byte = [0_u8; 1];
    let _ = read.read(&mut byte).await;
}
