mod wire;

#[cfg(unix)]
mod unix;
#[cfg(not(unix))]
mod unsupported;

#[cfg(test)]
#[cfg(unix)]
mod tests;

use crate::{bridge::activation::FallbackDirectoryHandle, DiagnosticsComponent};
use proliferate_diagnostics_protocol::v1::types::ProducerRecordV1;

pub(crate) use wire::FallbackReason;

pub(crate) const FALLBACK_SEGMENT_BYTES: u32 = 524_288;
pub(crate) const FALLBACK_SEGMENTS: usize = 4;
pub(crate) const FALLBACK_TOTAL_BYTES: u32 = FALLBACK_SEGMENT_BYTES * FALLBACK_SEGMENTS as u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FallbackStatus {
    pub(crate) active: bool,
    pub(crate) bytes: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum FallbackError {
    #[error("component fallback is unsupported")]
    Unsupported,
    #[error("component fallback directory is unsafe")]
    UnsafeDirectory,
    #[error("component fallback entry is unsafe")]
    UnsafeEntry,
    #[error("component fallback lock is held")]
    LockContended,
    #[error("component fallback record is invalid")]
    InvalidRecord,
    #[error("component fallback record belongs to another component")]
    ComponentMismatch,
    #[error("component fallback record exceeds the segment bound")]
    RecordTooLarge,
    #[error("component fallback I/O failed")]
    WriteFailed,
}

impl FallbackError {
    pub(crate) fn is_overflow(self) -> bool {
        self == Self::RecordTooLarge
    }
}

pub(crate) struct FallbackWriter {
    platform: platform::PlatformFallbackWriter,
}

impl FallbackWriter {
    pub(crate) fn from_directory(
        component: DiagnosticsComponent,
        directory: FallbackDirectoryHandle,
    ) -> Result<Self, FallbackError> {
        Ok(Self {
            platform: platform::PlatformFallbackWriter::from_directory(component, directory)?,
        })
    }

    /// Writes one already-filtered record from the producer's sole background worker.
    pub(crate) fn write(
        &mut self,
        reason: FallbackReason,
        record: &ProducerRecordV1,
    ) -> Result<u32, FallbackError> {
        self.platform.write(reason, record)
    }

    pub(crate) fn bytes(&self) -> u32 {
        self.platform.current_status().bytes
    }

    pub(crate) fn current_status(&self) -> FallbackStatus {
        self.platform.current_status()
    }

    #[cfg(all(test, unix))]
    fn write_encoded_for_test(&mut self, line: &[u8]) -> Result<u32, FallbackError> {
        self.platform.write_encoded_for_test(line)
    }
}

#[cfg(unix)]
use unix as platform;
#[cfg(not(unix))]
use unsupported as platform;
