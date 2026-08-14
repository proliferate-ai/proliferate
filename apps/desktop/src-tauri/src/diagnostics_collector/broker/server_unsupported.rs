use std::sync::Arc;

use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

#[derive(Debug)]
pub(crate) enum BrokerServerError {
    Unsupported,
}

#[derive(Debug)]
pub(crate) struct DiagnosticsBrokerServer;

impl DiagnosticsBrokerServer {
    pub(crate) async fn start(
        _supervisor: Arc<DiagnosticsCollectorSupervisor>,
    ) -> Result<Arc<Self>, BrokerServerError> {
        Err(BrokerServerError::Unsupported)
    }

    pub(crate) fn stop_accepting(&self) {}

    pub(crate) async fn wait_stopped(&self) -> Result<(), BrokerServerError> {
        Ok(())
    }

    pub(crate) fn remove_locator_and_unlock(&self) -> Result<(), BrokerServerError> {
        Ok(())
    }
}
