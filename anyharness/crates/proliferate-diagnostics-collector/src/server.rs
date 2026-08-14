use std::io;
use std::net::{SocketAddr, SocketAddrV4};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::serve::{Listener, ListenerExt};
use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, ProtectedTokenReferenceV1, TerminalOutcomeV1, TokenReferenceKindV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    parse_connection_descriptor_value, validate_connection_descriptor,
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinHandle;

use crate::config::CollectorConfig;
use crate::state::{CollectorCore, CoreError};

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("invalid collector configuration: {0}")]
    InvalidConfig(&'static str),
    #[error("collector listener failed: {0}")]
    Io(#[from] io::Error),
    #[error("collector core failed: {0}")]
    Core(#[from] CoreError),
    #[error("collector task failed: {0}")]
    Join(#[from] tokio::task::JoinError),
}

pub struct CollectorServer {
    core: Arc<CollectorCore>,
    endpoint: String,
    shutdown: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<io::Result<()>>>,
}

impl CollectorServer {
    pub async fn start(mut config: CollectorConfig) -> Result<Self, ServerError> {
        crate::auth::Capability::new(&config.capability).map_err(ServerError::InvalidConfig)?;
        let listener =
            TcpListener::bind(SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        if !address.ip().is_loopback() {
            return Err(ServerError::InvalidConfig(
                "collector listener is not loopback",
            ));
        }
        let core = CollectorCore::new(&config)?;
        let app = crate::http::router(Arc::clone(&core), &config.capability)
            .map_err(ServerError::InvalidConfig)?;
        config.capability.fill(0);
        let limited_listener =
            LimitedListener::new(listener, config.runtime_limits.open_connections).tap_io(|_| {});
        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
        let service = app.into_make_service_with_connect_info::<SocketAddr>();
        let task = tokio::spawn(async move {
            axum::serve(limited_listener, service)
                .with_graceful_shutdown(async move {
                    while !*shutdown_rx.borrow() {
                        if shutdown_rx.changed().await.is_err() {
                            break;
                        }
                    }
                })
                .await
        });
        let server = Self {
            core,
            endpoint: format!("http://{address}"),
            shutdown: Some(shutdown_tx),
            task: Some(task),
        };
        if config.auto_ready {
            server.mark_ready();
        }
        Ok(server)
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn core(&self) -> Arc<CollectorCore> {
        Arc::clone(&self.core)
    }

    pub fn mark_ready(&self) {
        self.core.mark_ready();
    }

    pub fn connection_descriptor(
        &self,
        capability_fd: u32,
    ) -> Result<ConnectionDescriptorV1, ServerError> {
        let descriptor = ConnectionDescriptorV1 {
            endpoint: self.endpoint.clone(),
            token_reference: ProtectedTokenReferenceV1 {
                kind: TokenReferenceKindV1::InheritedFileDescriptor,
                reference: capability_fd.to_string(),
            },
            schema_major: CURRENT_SCHEMA_VERSION.major,
            collector_boot_id: self.core.boot_id().to_owned(),
        };
        validate_connection_descriptor(&descriptor)
            .map_err(|_| ServerError::InvalidConfig("invalid connection descriptor"))?;
        let value = serde_json::to_value(descriptor)
            .map_err(|_| ServerError::InvalidConfig("invalid connection descriptor"))?;
        parse_connection_descriptor_value(&value)
            .map_err(|_| ServerError::InvalidConfig("invalid connection descriptor"))
    }

    pub async fn shutdown(mut self) -> Result<(), ServerError> {
        self.core.begin_shutdown();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(true);
        }
        let Some(mut task) = self.task.take() else {
            self.core.finish_shutdown(TerminalOutcomeV1::Succeeded);
            return Ok(());
        };
        // A failed serve task still owes the guaranteed terminal, so the
        // failure classifies the outcome instead of returning ahead of it.
        let (outcome, failure) =
            match tokio::time::timeout(self.core.limits.shutdown_deadline, &mut task).await {
                Ok(Ok(Ok(()))) => (TerminalOutcomeV1::Succeeded, None),
                Ok(Ok(Err(error))) => (TerminalOutcomeV1::Failed, Some(ServerError::Io(error))),
                Ok(Err(error)) => (TerminalOutcomeV1::Failed, Some(ServerError::Join(error))),
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    (TerminalOutcomeV1::TimedOut, None)
                }
            };
        self.core.finish_shutdown(outcome);
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Drop for CollectorServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(true);
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

struct LimitedListener {
    listener: TcpListener,
    permits: Arc<Semaphore>,
}

impl LimitedListener {
    fn new(listener: TcpListener, limit: usize) -> Self {
        Self {
            listener,
            permits: Arc::new(Semaphore::new(limit)),
        }
    }
}

impl Listener for LimitedListener {
    type Io = LimitedIo;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            let permit = Arc::clone(&self.permits)
                .acquire_owned()
                .await
                .expect("connection semaphore remains open");
            match self.listener.accept().await {
                Ok((stream, address)) => {
                    return (
                        LimitedIo {
                            stream,
                            _permit: permit,
                        },
                        address,
                    )
                }
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(25)).await,
            }
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

struct LimitedIo {
    stream: TcpStream,
    _permit: OwnedSemaphorePermit,
}

impl AsyncRead for LimitedIo {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_read(context, buffer)
    }
}

impl AsyncWrite for LimitedIo {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<Result<usize, io::Error>> {
        Pin::new(&mut self.get_mut().stream).poll_write(context, buffer)
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Result<(), io::Error>> {
        Pin::new(&mut self.get_mut().stream).poll_flush(context)
    }

    fn poll_shutdown(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), io::Error>> {
        Pin::new(&mut self.get_mut().stream).poll_shutdown(context)
    }

    fn is_write_vectored(&self) -> bool {
        self.stream.is_write_vectored()
    }

    fn poll_write_vectored(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffers: &[io::IoSlice<'_>],
    ) -> Poll<Result<usize, io::Error>> {
        Pin::new(&mut self.get_mut().stream).poll_write_vectored(context, buffers)
    }
}
