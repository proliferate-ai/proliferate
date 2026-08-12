use std::fmt;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
use std::os::unix::net::UnixStream as StdUnixStream;
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::ConnectionDescriptorV1;
use tokio::io::{AsyncWrite, AsyncWriteExt};

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
        #[cfg(test)]
        if self.test_faults.try_wait {
            return Err(io::Error::other("injected collector inspection failure"));
        }
        match self.child.as_mut() {
            Some(child) => child.try_wait(),
            None => Ok(None),
        }
    }

    pub(crate) fn observe_exit(&mut self) -> Result<Option<std::process::ExitStatus>, io::Error> {
        self.try_wait()
    }

    pub(crate) async fn write_shutdown(&mut self) -> Result<(), io::Error> {
        #[cfg(test)]
        if self.test_faults.control_write {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "injected collector control failure",
            ));
        }
        let encoded = typed_shutdown_command()?;
        let control = self
            .control
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "control channel closed"))?;
        write_orderly_shutdown_line(control, &encoded).await?;
        self.orderly_shutdown_requested = true;
        Ok(())
    }

    /// Duplicates the protected collector control descriptor for one terminal
    /// command. Duplication and async-stream setup happen before slot
    /// reservation because neither operation can place bytes on the wire.
    pub(crate) fn duplicate_terminal_control_descriptor(&self) -> Result<OwnedFd, io::Error> {
        let control = self
            .control
            .as_ref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "control channel closed"))?;
        // SAFETY: fcntl only duplicates the live descriptor owned by `control`;
        // the returned descriptor is adopted exactly once below.
        let duplicated = unsafe { libc::fcntl(control.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if duplicated < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `duplicated` is a fresh descriptor returned by F_DUPFD_CLOEXEC.
        Ok(unsafe { OwnedFd::from_raw_fd(duplicated) })
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
        #[cfg(test)]
        if self.test_faults.kill {
            return Err(io::Error::other("injected collector kill failure"));
        }
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
        #[cfg(test)]
        if self.test_faults.graceful_deadline {
            self.terminate_and_reap().await?;
            return Ok(CollectorShutdownOutcome::GracefulDeadlineExceeded);
        }
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

    #[cfg(test)]
    pub(crate) fn inject_test_fault(&mut self, fault: super::CollectorProcessTestFault) {
        match fault {
            super::CollectorProcessTestFault::TryWait => self.test_faults.try_wait = true,
            super::CollectorProcessTestFault::ControlWrite => self.test_faults.control_write = true,
            super::CollectorProcessTestFault::Kill => self.test_faults.kill = true,
            super::CollectorProcessTestFault::GracefulDeadline => {
                self.test_faults.graceful_deadline = true;
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn clear_test_faults(&mut self) {
        self.test_faults = super::CollectorProcessTestFaults::default();
    }
}

impl OwnedCollectorProcess {
    /// Converts one already-duplicated terminal authority into an async stream.
    /// Callers do this before reserving a producer slot so local setup failures
    /// cannot consume that slot.
    pub(crate) fn prepare_terminal_control_stream(
        descriptor: OwnedFd,
    ) -> Result<tokio::net::UnixStream, io::Error> {
        let raw = descriptor.into_raw_fd();
        // SAFETY: ownership was transferred out of the OwnedFd exactly once.
        let stream = unsafe { StdUnixStream::from_raw_fd(raw) };
        // The original tokio stream is already nonblocking. Setting the flag on
        // this duplicate is therefore idempotent for the shared file description.
        stream.set_nonblocking(true)?;
        tokio::net::UnixStream::from_std(stream)
    }

    /// Attempts exactly one write of an already-typed control document plus
    /// its newline. A partial write is ambiguous and is never retried.
    pub(crate) async fn write_terminal_control_line<W>(
        control: &mut W,
        encoded: &[u8],
    ) -> Result<(), io::Error>
    where
        W: AsyncWrite + Unpin,
    {
        validate_control_document(encoded)?;
        let mut line = Vec::with_capacity(encoded.len() + 1);
        line.extend_from_slice(encoded);
        line.push(b'\n');
        let written = control.write(&line).await?;
        if written != line.len() {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "collector control command write was partial",
            ));
        }
        control.flush().await
    }

    #[cfg(test)]
    pub(crate) async fn write_shutdown_control_line_for_test<W>(
        control: &mut W,
        encoded: &[u8],
    ) -> Result<(), io::Error>
    where
        W: AsyncWrite + Unpin,
    {
        write_orderly_shutdown_line(control, encoded).await
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

async fn write_orderly_shutdown_line<W>(control: &mut W, encoded: &[u8]) -> Result<(), io::Error>
where
    W: AsyncWrite + Unpin,
{
    validate_control_document(encoded)?;
    // Preserve the accepted PR 3 shutdown behavior: retry short writes until
    // the document and newline are complete, then flush the control stream.
    control.write_all(encoded).await?;
    control.write_all(b"\n").await?;
    control.flush().await
}

fn validate_control_document(encoded: &[u8]) -> Result<(), io::Error> {
    if encoded.is_empty()
        || encoded.contains(&b'\n')
        || encoded.len().saturating_add(1) > MAX_CONTROL_COMMAND_BYTES
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "collector control command is invalid",
        ));
    }
    Ok(())
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
