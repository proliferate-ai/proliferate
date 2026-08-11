use std::fmt;
use std::io;
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::ConnectionDescriptorV1;
use tokio::io::AsyncWriteExt;

use crate::diagnostics_collector::client::{CollectorHttpClient, SecretCapability};

use super::{
    CollectorShutdownOutcome, OwnedCollectorProcess, COLLECTOR_FORCE_REAP_TIMEOUT,
    COLLECTOR_GRACEFUL_SHUTDOWN_TIMEOUT, MAX_CONTROL_COMMAND_BYTES,
};

impl fmt::Debug for OwnedCollectorProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnedCollectorProcess")
            .field("collector_boot_id", &self.descriptor.collector_boot_id)
            .field("schema_major", &self.descriptor.schema_major)
            .field("owned", &self.child.is_some())
            .field(
                "orderly_shutdown_requested",
                &self.orderly_shutdown_requested,
            )
            .finish()
    }
}

impl OwnedCollectorProcess {
    pub(crate) fn client(&self) -> Arc<CollectorHttpClient> {
        Arc::clone(&self.client)
    }

    pub(crate) fn descriptor(&self) -> &ConnectionDescriptorV1 {
        &self.descriptor
    }

    pub(crate) fn capability_bytes(&self) -> &[u8] {
        self.capability.as_bytes()
    }

    pub(crate) fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, io::Error> {
        match self.child.as_mut() {
            Some(child) => child.try_wait(),
            None => Ok(None),
        }
    }

    pub(crate) fn observe_exit(&mut self) -> Result<Option<std::process::ExitStatus>, io::Error> {
        self.try_wait()
    }

    pub(crate) async fn write_shutdown(&mut self) -> Result<(), io::Error> {
        let encoded = typed_shutdown_command()?;
        let control = self
            .control
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "control channel closed"))?;
        control.write_all(&encoded).await?;
        control.write_all(b"\n").await?;
        control.flush().await?;
        self.orderly_shutdown_requested = true;
        Ok(())
    }

    pub(crate) async fn wait(&mut self) -> Result<std::process::ExitStatus, io::Error> {
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "collector handle missing"))?;
        let status = child.wait().await?;
        self.finish_reaped();
        Ok(status)
    }

    pub(crate) fn start_kill(&mut self) -> Result<(), io::Error> {
        self.child
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "collector handle missing"))?
            .start_kill()
    }

    pub(crate) async fn terminate_and_reap(&mut self) -> Result<(), io::Error> {
        if self.try_wait()?.is_some() {
            self.finish_reaped();
            return Ok(());
        }
        if let Err(kill_error) = self.start_kill() {
            if self.try_wait()?.is_some() {
                self.finish_reaped();
                return Ok(());
            }
            return Err(kill_error);
        }
        tokio::time::timeout(COLLECTOR_FORCE_REAP_TIMEOUT, self.wait())
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "collector reap timed out"))??;
        Ok(())
    }

    pub(crate) async fn orderly_shutdown(&mut self) -> Result<CollectorShutdownOutcome, io::Error> {
        if self.write_shutdown().await.is_err() {
            self.terminate_and_reap().await?;
            return Ok(CollectorShutdownOutcome::ControlWriteFailed);
        }
        match tokio::time::timeout(COLLECTOR_GRACEFUL_SHUTDOWN_TIMEOUT, self.wait()).await {
            Ok(result) => result.map(|_| CollectorShutdownOutcome::Graceful),
            Err(_) => {
                self.terminate_and_reap().await?;
                Ok(CollectorShutdownOutcome::GracefulDeadlineExceeded)
            }
        }
    }

    pub(crate) fn finish_reaped(&mut self) {
        self.child.take();
        self.control.take();
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}

pub(super) fn typed_shutdown_command() -> Result<Vec<u8>, io::Error> {
    let encoded = serde_json::to_vec(&serde_json::json!({"command": "shutdown"}))
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "shutdown command"))?;
    if encoded.len().saturating_add(1) > MAX_CONTROL_COMMAND_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "shutdown command exceeds control cap",
        ));
    }
    Ok(encoded)
}

impl Drop for OwnedCollectorProcess {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.start_kill();
        }
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}
