//! Customer collector builds.
//!
//! Every method is an inlined no-op, so a customer binary contains no
//! background export path, no destination configuration read, and no
//! credential material at all. Health always reports the neutral exporter
//! state that the standalone release RSS profile pins.

use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::{ExporterHealthV1, ExporterStateV1};

pub(crate) struct ExporterHandle;

impl ExporterHandle {
    pub(crate) fn from_environment() -> Self {
        Self
    }

    pub(crate) fn spawn(&self) {}

    #[inline]
    pub(crate) fn offer(&self, _encoded: &Arc<[u8]>) {}

    pub(crate) fn health(&self) -> ExporterHealthV1 {
        ExporterHealthV1 {
            state: ExporterStateV1::Disabled,
            dropped_records: 0,
            last_error_classification: None,
        }
    }

    pub(crate) async fn shutdown(&self) {}
}
