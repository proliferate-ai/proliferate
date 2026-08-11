use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{unix::OwnedReadHalf, UnixListener, UnixStream};
use tokio::sync::{watch, Semaphore};
use tokio::task::{JoinHandle, JoinSet};

use super::discovery::{
    current_server_scope, BrokerDiscoveryGuard, DiagnosticsBrokerScope, DiscoveryError,
};
use super::protocol::{
    parse_exact_request, DiagnosticsBrokerErrorV1, DiagnosticsBrokerPayloadV1,
    DiagnosticsBrokerRequestV1, DiagnosticsBrokerResponseV1, BROKER_PROTOCOL_VERSION,
    MAX_BROKER_CONNECTIONS, MAX_BROKER_EXPORTS, MAX_BROKER_FINITE_REQUESTS,
    MAX_BROKER_REQUEST_FRAME_BYTES, MAX_BROKER_RESPONSE_FRAME_BYTES, MAX_BROKER_TAILS,
};
use crate::diagnostics_collector::artifact::DiagnosticsArtifactKind;
use crate::diagnostics_collector::supervisor::{
    DiagnosticsCollectorSupervisor, SupervisorUnavailable,
};

const SERVER_INITIAL_REQUEST_TIMEOUT: Duration = Duration::from_secs(1);
const BROKER_FINITE_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const BROKER_STREAM_FRAME_WRITE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug)]
pub(crate) enum BrokerServerError {
    Discovery(DiscoveryError),
    Io,
    Join,
}

impl From<DiscoveryError> for BrokerServerError {
    fn from(value: DiscoveryError) -> Self {
        Self::Discovery(value)
    }
}

#[derive(Clone)]
struct BrokerLimits {
    connections: Arc<Semaphore>,
    finite: Arc<Semaphore>,
    tails: Arc<Semaphore>,
    exports: Arc<Semaphore>,
}

pub(crate) struct DiagnosticsBrokerServer {
    app_boot_id: String,
    scope: DiagnosticsBrokerScope,
    shutdown_tx: watch::Sender<bool>,
    accept_task: Mutex<Option<JoinHandle<()>>>,
    discovery: Mutex<Option<BrokerDiscoveryGuard>>,
}

impl std::fmt::Debug for DiagnosticsBrokerServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DiagnosticsBrokerServer")
            .field("app_boot_id", &self.app_boot_id)
            .field("scope_id", &self.scope.scope_id)
            .finish_non_exhaustive()
    }
}

impl DiagnosticsBrokerServer {
    pub(crate) async fn start(
        supervisor: Arc<DiagnosticsCollectorSupervisor>,
    ) -> Result<Arc<Self>, BrokerServerError> {
        let scope = current_server_scope()?;
        let app_boot_id = uuid::Uuid::new_v4().to_string();
        let mut discovery =
            BrokerDiscoveryGuard::acquire(scope.clone(), app_boot_id.clone()).await?;
        let listener = UnixListener::bind(&scope.socket_path).map_err(|_| BrokerServerError::Io)?;
        if fs::set_permissions(&scope.socket_path, fs::Permissions::from_mode(0o600)).is_err() {
            drop(listener);
            let _ = fs::remove_file(&scope.socket_path);
            return Err(BrokerServerError::Io);
        }
        if let Err(error) = discovery.publish() {
            drop(listener);
            let _ = fs::remove_file(&scope.socket_path);
            return Err(error.into());
        }
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let limits = BrokerLimits {
            connections: Arc::new(Semaphore::new(MAX_BROKER_CONNECTIONS)),
            finite: Arc::new(Semaphore::new(MAX_BROKER_FINITE_REQUESTS)),
            tails: Arc::new(Semaphore::new(MAX_BROKER_TAILS)),
            exports: Arc::new(Semaphore::new(MAX_BROKER_EXPORTS)),
        };
        let task_app_boot_id = app_boot_id.clone();
        let accept_task = tokio::spawn(async move {
            accept_loop(listener, supervisor, task_app_boot_id, shutdown_rx, limits).await;
        });
        Ok(Arc::new(Self {
            app_boot_id,
            scope,
            shutdown_tx,
            accept_task: Mutex::new(Some(accept_task)),
            discovery: Mutex::new(Some(discovery)),
        }))
    }

    pub(crate) fn app_boot_id(&self) -> &str {
        &self.app_boot_id
    }

    pub(crate) fn stop_accepting(&self) {
        let _ = self.shutdown_tx.send(true);
    }

    pub(crate) async fn wait_stopped(&self) -> Result<(), BrokerServerError> {
        let task = self
            .accept_task
            .lock()
            .map_err(|_| BrokerServerError::Join)?
            .take();
        if let Some(task) = task {
            tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .map_err(|_| BrokerServerError::Join)?
                .map_err(|_| BrokerServerError::Join)?;
        }
        Ok(())
    }

    pub(crate) fn remove_locator_and_unlock(&self) -> Result<(), BrokerServerError> {
        let mut discovery = self.discovery.lock().map_err(|_| BrokerServerError::Join)?;
        if let Some(mut guard) = discovery.take() {
            guard.cleanup()?;
        }
        Ok(())
    }
}

impl Drop for DiagnosticsBrokerServer {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
    }
}

async fn accept_loop(
    listener: UnixListener,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    app_boot_id: String,
    mut shutdown: watch::Receiver<bool>,
    limits: BrokerLimits,
) {
    let mut sessions = JoinSet::new();
    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else {
                    break;
                };
                let Ok(permit) = Arc::clone(&limits.connections).try_acquire_owned() else {
                    drop(stream);
                    continue;
                };
                let supervisor = Arc::clone(&supervisor);
                let app_boot_id = app_boot_id.clone();
                let limits = limits.clone();
                let session_shutdown = shutdown.clone();
                sessions.spawn(async move {
                    let _permit = permit;
                    handle_connection(
                        stream,
                        supervisor,
                        app_boot_id,
                        session_shutdown,
                        limits,
                    )
                    .await;
                });
            }
            _ = sessions.join_next(), if !sessions.is_empty() => {}
        }
    }
    sessions.abort_all();
    while sessions.join_next().await.is_some() {}
}

async fn handle_connection(
    mut stream: UnixStream,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    app_boot_id: String,
    shutdown: watch::Receiver<bool>,
    limits: BrokerLimits,
) {
    let credentials = match stream.peer_cred() {
        Ok(credentials) if credentials.uid() == effective_uid() => credentials,
        _ => return,
    };
    let _ = credentials;
    let request_bytes = match tokio::time::timeout(
        SERVER_INITIAL_REQUEST_TIMEOUT,
        read_frame(&mut stream, MAX_BROKER_REQUEST_FRAME_BYTES),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        _ => return,
    };
    let request = match parse_exact_request(&request_bytes) {
        Ok(request) => request,
        Err(_) => return,
    };
    let request_id = request.request_id().to_string();
    if request.app_boot_id() != app_boot_id {
        let _ = write_error(
            &mut stream,
            &app_boot_id,
            &request_id,
            DiagnosticsBrokerErrorV1::StaleAppBoot,
        )
        .await;
        return;
    }
    if *shutdown.borrow() {
        let _ = write_error(
            &mut stream,
            &app_boot_id,
            &request_id,
            DiagnosticsBrokerErrorV1::BrokerShuttingDown,
        )
        .await;
        return;
    }

    match request {
        DiagnosticsBrokerRequestV1::Health { .. } => {
            let Ok(_permit) = Arc::clone(&limits.finite).try_acquire_owned() else {
                let _ = write_error(
                    &mut stream,
                    &app_boot_id,
                    &request_id,
                    DiagnosticsBrokerErrorV1::BrokerBusy,
                )
                .await;
                return;
            };
            if write_accepted(&mut stream, &app_boot_id, &request_id)
                .await
                .is_err()
            {
                return;
            }
            let result =
                tokio::time::timeout(BROKER_FINITE_COMMAND_TIMEOUT, supervisor.health()).await;
            match result {
                Ok(health) => {
                    let _ = write_payload(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        DiagnosticsBrokerPayloadV1::Health(health),
                    )
                    .await;
                    let _ = write_end(&mut stream, &app_boot_id, &request_id).await;
                }
                Err(_) => {
                    let _ = write_error(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        DiagnosticsBrokerErrorV1::DeadlineExceeded,
                    )
                    .await;
                }
            }
        }
        DiagnosticsBrokerRequestV1::Records { request, .. } => {
            let Ok(_permit) = Arc::clone(&limits.finite).try_acquire_owned() else {
                let _ = write_error(
                    &mut stream,
                    &app_boot_id,
                    &request_id,
                    DiagnosticsBrokerErrorV1::BrokerBusy,
                )
                .await;
                return;
            };
            if write_accepted(&mut stream, &app_boot_id, &request_id)
                .await
                .is_err()
            {
                return;
            }
            match tokio::time::timeout(BROKER_FINITE_COMMAND_TIMEOUT, supervisor.records(&request))
                .await
            {
                Ok(Ok(page)) => {
                    let _ = write_payload(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        DiagnosticsBrokerPayloadV1::Records(page),
                    )
                    .await;
                    let _ = write_end(&mut stream, &app_boot_id, &request_id).await;
                }
                Ok(Err(error)) => {
                    let _ = write_error(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        map_supervisor_error(error),
                    )
                    .await;
                }
                Err(_) => {
                    let _ = write_error(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        DiagnosticsBrokerErrorV1::DeadlineExceeded,
                    )
                    .await;
                }
            }
        }
        DiagnosticsBrokerRequestV1::Tail {
            schema_version,
            after_cursor,
            ..
        } => {
            if schema_version != CURRENT_SCHEMA_VERSION {
                let _ = write_error(
                    &mut stream,
                    &app_boot_id,
                    &request_id,
                    DiagnosticsBrokerErrorV1::InvalidRequest,
                )
                .await;
                return;
            }
            let Ok(_permit) = Arc::clone(&limits.tails).try_acquire_owned() else {
                let _ = write_error(
                    &mut stream,
                    &app_boot_id,
                    &request_id,
                    DiagnosticsBrokerErrorV1::BrokerBusy,
                )
                .await;
                return;
            };
            if write_accepted(&mut stream, &app_boot_id, &request_id)
                .await
                .is_err()
            {
                return;
            }
            let lease = match supervisor.tail(after_cursor).await {
                Ok(lease) => lease,
                Err(error) => {
                    let _ = write_error(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        map_supervisor_error(error),
                    )
                    .await;
                    return;
                }
            };
            stream_tail(stream, lease, &app_boot_id, &request_id).await;
        }
        DiagnosticsBrokerRequestV1::Export { request, .. } => {
            let Ok(_permit) = Arc::clone(&limits.exports).try_acquire_owned() else {
                let _ = write_error(
                    &mut stream,
                    &app_boot_id,
                    &request_id,
                    DiagnosticsBrokerErrorV1::BrokerBusy,
                )
                .await;
                return;
            };
            if write_accepted(&mut stream, &app_boot_id, &request_id)
                .await
                .is_err()
            {
                return;
            }
            let lease = match supervisor
                .export(&request, DiagnosticsArtifactKind::current())
                .await
            {
                Ok(lease) => lease,
                Err(error) => {
                    let _ = write_error(
                        &mut stream,
                        &app_boot_id,
                        &request_id,
                        map_supervisor_error(error),
                    )
                    .await;
                    return;
                }
            };
            stream_export(
                stream,
                Arc::clone(&supervisor),
                lease,
                &app_boot_id,
                &request_id,
            )
            .await;
        }
    }
}

async fn stream_tail(
    stream: UnixStream,
    mut lease: crate::diagnostics_collector::supervisor::SupervisorTailLease,
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
        if *lease.shutdown.borrow() {
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
            frame = lease.stream.next() => match frame {
                Ok(Some(frame)) => {
                    if write_payload(&mut write, app_boot_id, request_id, DiagnosticsBrokerPayloadV1::Tail(frame)).await.is_err() {
                        return;
                    }
                }
                Ok(None) => {
                    let _ = write_end(&mut write, app_boot_id, request_id).await;
                    return;
                }
                Err(_) => {
                    let _ = write_error(&mut write, app_boot_id, request_id, DiagnosticsBrokerErrorV1::CollectorUnavailable).await;
                    return;
                }
            }
        }
    }
}

async fn stream_export(
    stream: UnixStream,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    mut lease: crate::diagnostics_collector::supervisor::SupervisorExportLease,
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
        if *lease.shutdown.borrow() {
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
            frame = lease.stream.next() => match frame {
                Ok(Some(frame)) => match supervisor.contextualize_export(lease.generation, lease.restart_count, frame) {
                    Ok(frame) => {
                        if write_payload(&mut write, app_boot_id, request_id, DiagnosticsBrokerPayloadV1::Export(frame)).await.is_err() {
                            return;
                        }
                    }
                    Err(_) => {
                        let _ = write_error(&mut write, app_boot_id, request_id, DiagnosticsBrokerErrorV1::ProtocolError).await;
                        return;
                    }
                },
                Ok(None) => {
                    let _ = write_end(&mut write, app_boot_id, request_id).await;
                    return;
                }
                Err(_) => {
                    let _ = write_error(&mut write, app_boot_id, request_id, DiagnosticsBrokerErrorV1::CollectorUnavailable).await;
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

#[path = "server/framing.rs"]
mod framing;
use framing::{
    effective_uid, map_supervisor_error, read_frame, write_accepted, write_end, write_error,
    write_payload,
};
#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
