use proliferate_diagnostics_protocol::v1::types::ProducerRecordV1;

use crate::{bridge::activation::FallbackDirectoryHandle, DiagnosticsComponent};

use super::{FallbackError, FallbackReason, FallbackStatus};

pub(super) struct PlatformFallbackWriter;

impl PlatformFallbackWriter {
    pub(super) fn from_directory(
        _component: DiagnosticsComponent,
        _directory: FallbackDirectoryHandle,
    ) -> Result<Self, FallbackError> {
        Err(FallbackError::Unsupported)
    }

    pub(super) fn write(
        &mut self,
        _reason: FallbackReason,
        _record: &ProducerRecordV1,
    ) -> Result<u32, FallbackError> {
        Err(FallbackError::Unsupported)
    }

    pub(super) fn current_status(&self) -> FallbackStatus {
        FallbackStatus {
            active: false,
            bytes: 0,
        }
    }
}
