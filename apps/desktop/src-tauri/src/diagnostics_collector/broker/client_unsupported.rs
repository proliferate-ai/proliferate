use std::fmt;

use proliferate_diagnostics_protocol::v1::types::{
    ExportRequestV1, ExportStreamFrameV1, RecordsPageV1, RecordsQueryV1, TailFrameV1,
};

use super::protocol::DiagnosticsBrokerErrorV1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticsBrokerClientError {
    classification: DiagnosticsBrokerErrorV1,
    supervisor: Option<super::protocol::DesktopDiagnosticsSupervisorStateV1>,
}

impl DiagnosticsBrokerClientError {
    pub fn classification(&self) -> DiagnosticsBrokerErrorV1 {
        self.classification
    }

    pub fn classification_name(&self) -> &'static str {
        "collector_unavailable"
    }

    pub fn supervisor_state(
        &self,
    ) -> Option<&super::protocol::DesktopDiagnosticsSupervisorStateV1> {
        self.supervisor.as_ref()
    }
}

impl fmt::Display for DiagnosticsBrokerClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.classification_name())
    }
}

impl std::error::Error for DiagnosticsBrokerClientError {}

#[derive(Debug, Clone)]
pub struct DiagnosticsBrokerClient {
    _profile: Option<String>,
}

impl DiagnosticsBrokerClient {
    pub fn new(profile: Option<String>) -> Self {
        Self { _profile: profile }
    }

    pub async fn health(&self) -> Result<serde_json::Value, DiagnosticsBrokerClientError> {
        Err(unavailable())
    }

    pub async fn records(
        &self,
        _request: RecordsQueryV1,
    ) -> Result<RecordsPageV1, DiagnosticsBrokerClientError> {
        Err(unavailable())
    }

    pub async fn tail(
        &self,
        _after_cursor: Option<u64>,
    ) -> Result<DiagnosticsBrokerTailStream, DiagnosticsBrokerClientError> {
        Err(unavailable())
    }

    pub async fn export(
        &self,
        _request: ExportRequestV1,
    ) -> Result<DiagnosticsBrokerExportStream, DiagnosticsBrokerClientError> {
        Err(unavailable())
    }
}

pub struct DiagnosticsBrokerTailStream;

impl DiagnosticsBrokerTailStream {
    pub async fn next(&mut self) -> Result<Option<TailFrameV1>, DiagnosticsBrokerClientError> {
        Err(unavailable())
    }
}

pub struct DiagnosticsBrokerExportStream;

impl DiagnosticsBrokerExportStream {
    pub async fn next(
        &mut self,
    ) -> Result<Option<ExportStreamFrameV1>, DiagnosticsBrokerClientError> {
        Err(unavailable())
    }
}

fn unavailable() -> DiagnosticsBrokerClientError {
    DiagnosticsBrokerClientError {
        classification: DiagnosticsBrokerErrorV1::CollectorUnavailable,
        supervisor: None,
    }
}
