use std::fs::File;
use std::io::{self, Read};
use std::os::fd::FromRawFd;
use std::sync::Arc;

use serde::Deserialize;
use tokio::io::AsyncReadExt;

use crate::CollectorCore;

const MAX_CAPABILITY_BYTES: u64 = 257;
const MAX_CONTROL_COMMAND_BYTES: usize = 4_096;

#[derive(Debug, thiserror::Error)]
pub enum ProcessChannelError {
    #[error("inherited descriptor must be at least 3")]
    InvalidDescriptor,
    #[error("inherited channel I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("capability channel was empty or over limit")]
    InvalidCapability,
    #[error("control command was malformed or over limit")]
    InvalidControlCommand,
    #[error("collector core rejected control command: {0}")]
    Core(#[from] crate::CoreError),
}

pub fn read_capability_from_fd(fd: i32) -> Result<Vec<u8>, ProcessChannelError> {
    if fd < 3 {
        return Err(ProcessChannelError::InvalidDescriptor);
    }
    // SAFETY: this process receives ownership of the inherited descriptor.
    let file = unsafe { File::from_raw_fd(fd) };
    let mut capability = Vec::new();
    file.take(MAX_CAPABILITY_BYTES)
        .read_to_end(&mut capability)?;
    while matches!(capability.last(), Some(b'\n' | b'\r')) {
        capability.pop();
    }
    if capability.is_empty() || capability.len() > 256 {
        capability.fill(0);
        return Err(ProcessChannelError::InvalidCapability);
    }
    Ok(capability)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum ControlCommand {
    Shutdown,
    ProducerDead { producer_boot_id: String },
    ResetProfileCounters,
}

pub struct ControlChannel {
    file: tokio::fs::File,
    pending: Vec<u8>,
}

impl ControlChannel {
    pub fn from_fd(fd: i32) -> Result<Self, ProcessChannelError> {
        if fd < 3 {
            return Err(ProcessChannelError::InvalidDescriptor);
        }
        // SAFETY: this process receives ownership of the inherited descriptor.
        let file = unsafe { File::from_raw_fd(fd) };
        Ok(Self {
            file: tokio::fs::File::from_std(file),
            pending: Vec::with_capacity(256),
        })
    }

    pub async fn wait_for_shutdown(
        mut self,
        core: Arc<CollectorCore>,
    ) -> Result<(), ProcessChannelError> {
        let mut chunk = [0_u8; 512];
        loop {
            let read = self.file.read(&mut chunk).await?;
            if read == 0 {
                return Ok(());
            }
            for byte in &chunk[..read] {
                if *byte == b'\n' {
                    let line = std::mem::take(&mut self.pending);
                    if self.apply_line(&core, &line)? {
                        return Ok(());
                    }
                    continue;
                }
                if self.pending.len() == MAX_CONTROL_COMMAND_BYTES {
                    self.pending.clear();
                    return Err(ProcessChannelError::InvalidControlCommand);
                }
                self.pending.push(*byte);
            }
        }
    }

    fn apply_line(&self, core: &CollectorCore, line: &[u8]) -> Result<bool, ProcessChannelError> {
        let command: ControlCommand =
            serde_json::from_slice(line).map_err(|_| ProcessChannelError::InvalidControlCommand)?;
        match command {
            ControlCommand::Shutdown => Ok(true),
            ControlCommand::ProducerDead { producer_boot_id } => {
                core.mark_producer_dead(&producer_boot_id)?;
                Ok(false)
            }
            ControlCommand::ResetProfileCounters => {
                core.reset_profile_counters();
                Ok(false)
            }
        }
    }
}

pub async fn wait_for_process_shutdown(
    core: Arc<CollectorCore>,
    control_fd: Option<i32>,
) -> Result<(), ProcessChannelError> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        let control = async move {
            match control_fd {
                Some(fd) => ControlChannel::from_fd(fd)?.wait_for_shutdown(core).await,
                None => std::future::pending::<Result<(), ProcessChannelError>>().await,
            }
        };
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.map_err(ProcessChannelError::Io),
            _ = terminate.recv() => Ok(()),
            result = control => result,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (core, control_fd);
        tokio::signal::ctrl_c()
            .await
            .map_err(ProcessChannelError::Io)
    }
}
