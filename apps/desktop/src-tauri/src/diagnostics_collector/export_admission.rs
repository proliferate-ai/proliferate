use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};

use super::broker::protocol::MAX_BROKER_EXPORTS;

pub(crate) struct ExportAdmission {
    slots: Arc<Semaphore>,
}

impl ExportAdmission {
    pub(crate) fn shared_capacity_one() -> Arc<Self> {
        assert_eq!(
            MAX_BROKER_EXPORTS, 1,
            "export admission must remain singular"
        );
        Arc::new(Self {
            slots: Arc::new(Semaphore::new(1)),
        })
    }

    pub(crate) fn try_acquire_owned(
        self: Arc<Self>,
    ) -> Result<ExportAdmissionPermit, TryAcquireError> {
        Arc::clone(&self.slots)
            .try_acquire_owned()
            .map(|permit| ExportAdmissionPermit { _permit: permit })
    }
}

pub(crate) struct ExportAdmissionPermit {
    _permit: OwnedSemaphorePermit,
}

#[cfg(test)]
#[path = "export_admission_tests.rs"]
mod tests;
