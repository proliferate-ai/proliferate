use chrono::DateTime;
use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_EXPORT_RECORDS};
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ComponentV1, ExportManifestV1, ExportPurposeV1, ExportRequestV1,
    GapV1, HealthResponseV1, RecordClassV1, RecordsFilterV1,
};
use proliferate_diagnostics_protocol::v1::validation::validate_export_request;
use tokio::sync::watch;
use tokio::time::Instant;

use super::supervisor::{DiagnosticsCollectorSupervisor, SupervisorUnavailable};
use validation::SupportExportAccumulator;

const SUPPORT_EXPORT_BYTES: u64 = 16_777_216;
const SUPPORT_WINDOW_SECONDS: i64 = 15 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupportExportError {
    InvalidRequest,
    InvalidAuthority,
    Busy,
    Cancelled,
    Deadline,
    CollectorUnavailable,
    CollectorReplaced,
    InvalidStream,
    Unsupported,
}

pub(crate) struct SupportExportRequest {
    collector: ExportRequestV1,
    preparation_id: String,
    expires_at: Instant,
}

pub(crate) struct SupportExportPermit {
    authorization_id: String,
    preparation_id: String,
    expires_at: Instant,
    bound_request: ExportRequestV1,
}

pub(in crate::diagnostics_collector) struct ConsumedSupportExportPermit {
    _authorization_id: String,
    _preparation_id: String,
    _expires_at: Instant,
}

impl SupportExportPermit {
    pub(super) fn issue_for_coordinator(
        preparation_id: &str,
        source_time_from: String,
        source_time_to: String,
        expires_at: Instant,
    ) -> Result<(SupportExportRequest, Self), SupportExportError> {
        require_canonical_uuid(preparation_id).map_err(|_| SupportExportError::InvalidRequest)?;
        if expires_at <= Instant::now()
            || !is_exact_support_window(&source_time_from, &source_time_to)
        {
            return Err(SupportExportError::InvalidRequest);
        }
        let authorization_id = uuid::Uuid::new_v4().to_string();
        let collector = exact_request(authorization_id.clone(), source_time_from, source_time_to);
        validate_support_request(&collector, &authorization_id)?;
        let request = SupportExportRequest {
            collector: collector.clone(),
            preparation_id: preparation_id.to_owned(),
            expires_at,
        };
        let permit = Self {
            authorization_id,
            preparation_id: preparation_id.to_owned(),
            expires_at,
            bound_request: collector,
        };
        Ok((request, permit))
    }

    fn consume(
        self,
        request: &SupportExportRequest,
    ) -> Result<ConsumedSupportExportPermit, SupportExportError> {
        if request.preparation_id != self.preparation_id
            || request.expires_at != self.expires_at
            || request.collector != self.bound_request
            || request.expires_at <= Instant::now()
        {
            return Err(SupportExportError::InvalidAuthority);
        }
        require_canonical_uuid(&self.preparation_id)
            .map_err(|_| SupportExportError::InvalidAuthority)?;
        validate_support_request(&request.collector, &self.authorization_id)
            .map_err(|_| SupportExportError::InvalidAuthority)?;
        Ok(ConsumedSupportExportPermit {
            _authorization_id: self.authorization_id,
            _preparation_id: self.preparation_id,
            _expires_at: self.expires_at,
        })
    }
}

#[cfg(unix)]
pub(in crate::diagnostics_collector) struct SupportSupervisorExportLease {
    inner: super::supervisor::SupervisorExportLease,
    _authority: ConsumedSupportExportPermit,
}

#[cfg(unix)]
impl SupportSupervisorExportLease {
    pub(in crate::diagnostics_collector) fn new(
        inner: super::supervisor::SupervisorExportLease,
        authority: ConsumedSupportExportPermit,
    ) -> Self {
        Self {
            inner,
            _authority: authority,
        }
    }
}

pub(crate) struct ValidatedSupportExport {
    pub(crate) manifest: ExportManifestV1,
    pub(crate) records: Vec<CollectorAcceptedRecordV1>,
    pub(crate) gaps: Vec<GapV1>,
    pub(crate) health: HealthResponseV1,
}

#[cfg(unix)]
impl DiagnosticsCollectorSupervisor {
    pub(crate) async fn export_support_snapshot(
        &self,
        request: SupportExportRequest,
        permit: SupportExportPermit,
        mut cancellation: watch::Receiver<bool>,
    ) -> Result<ValidatedSupportExport, SupportExportError> {
        let authority = permit.consume(&request)?;
        if *cancellation.borrow() {
            return Err(SupportExportError::Cancelled);
        }
        let _admission = self
            .export_admission()
            .try_acquire_owned()
            .map_err(|_| SupportExportError::Busy)?;
        let deadline_at = request.expires_at;
        let deadline = tokio::time::sleep_until(deadline_at);
        tokio::pin!(deadline);
        let mut opening_shutdown = self.subscribe_shutdown();
        let mut opening_generation = self.subscribe_generation();
        let mut lease = {
            let opening = self.support_export_query(&request.collector, authority);
            tokio::pin!(opening);
            tokio::select! {
                _ = &mut deadline => return Err(SupportExportError::Deadline),
                _ = cancellation.changed() => return Err(SupportExportError::Cancelled),
                _ = opening_shutdown.changed() => return Err(SupportExportError::Cancelled),
                _ = opening_generation.changed() => return Err(SupportExportError::CollectorReplaced),
                result = &mut opening => result.map_err(map_supervisor_error)?,
            }
        };
        let mut accumulator = SupportExportAccumulator::new(request.collector)?;

        loop {
            if Instant::now() >= deadline_at {
                return Err(SupportExportError::Deadline);
            }
            if *cancellation.borrow() || *lease.inner.shutdown.borrow() {
                return Err(SupportExportError::Cancelled);
            }
            if *lease.inner.generation_changed.borrow() != lease.inner.generation {
                return Err(SupportExportError::CollectorReplaced);
            }
            tokio::select! {
                _ = &mut deadline => return Err(SupportExportError::Deadline),
                changed = cancellation.changed() => {
                    if changed.is_err() || *cancellation.borrow() {
                        return Err(SupportExportError::Cancelled);
                    }
                }
                changed = lease.inner.shutdown.changed() => {
                    if changed.is_err() || *lease.inner.shutdown.borrow() {
                        return Err(SupportExportError::Cancelled);
                    }
                }
                changed = lease.inner.generation_changed.changed() => {
                    if changed.is_err()
                        || *lease.inner.generation_changed.borrow() != lease.inner.generation
                    {
                        return Err(SupportExportError::CollectorReplaced);
                    }
                }
                frame = lease.inner.stream.next() => match frame {
                    Ok(Some(frame)) => {
                        let frame = self.contextualize_export(
                            lease.inner.generation,
                            lease.inner.restart_count,
                            frame,
                        ).map_err(map_supervisor_error)?;
                        accumulator.push(frame)?;
                    }
                    Ok(None) => {
                        if Instant::now() >= deadline_at {
                            return Err(SupportExportError::Deadline);
                        }
                        if *lease.inner.shutdown.borrow() || *cancellation.borrow() {
                            return Err(SupportExportError::Cancelled);
                        }
                        if *lease.inner.generation_changed.borrow() != lease.inner.generation {
                            return Err(SupportExportError::CollectorReplaced);
                        }
                        return accumulator.finish();
                    }
                    Err(error) => return Err(match error {
                        super::client::CollectorClientError::Deadline => SupportExportError::Deadline,
                        super::client::CollectorClientError::Protocol => SupportExportError::InvalidStream,
                        _ => SupportExportError::CollectorUnavailable,
                    }),
                }
            }
        }
    }
}

#[cfg(not(unix))]
impl DiagnosticsCollectorSupervisor {
    pub(crate) async fn export_support_snapshot(
        &self,
        request: SupportExportRequest,
        permit: SupportExportPermit,
        cancellation: watch::Receiver<bool>,
    ) -> Result<ValidatedSupportExport, SupportExportError> {
        let _authority = permit.consume(&request)?;
        if *cancellation.borrow() {
            return Err(SupportExportError::Cancelled);
        }
        let _admission = self
            .export_admission()
            .try_acquire_owned()
            .map_err(|_| SupportExportError::Busy)?;
        Err(SupportExportError::Unsupported)
    }
}

fn map_supervisor_error(error: SupervisorUnavailable) -> SupportExportError {
    match error {
        SupervisorUnavailable::Replaced => SupportExportError::CollectorReplaced,
        SupervisorUnavailable::ShuttingDown => SupportExportError::Cancelled,
        SupervisorUnavailable::Deadline => SupportExportError::Deadline,
        SupervisorUnavailable::Protocol | SupervisorUnavailable::CollectorRejected => {
            SupportExportError::InvalidStream
        }
        SupervisorUnavailable::Unsupported => SupportExportError::Unsupported,
        SupervisorUnavailable::Starting
        | SupervisorUnavailable::Degraded
        | SupervisorUnavailable::Stopped => SupportExportError::CollectorUnavailable,
    }
}

fn exact_request(
    authorization_id: String,
    source_time_from: String,
    source_time_to: String,
) -> ExportRequestV1 {
    ExportRequestV1 {
        schema_version: CURRENT_SCHEMA_VERSION,
        purpose: ExportPurposeV1::Support,
        support_authorization_id: Some(authorization_id),
        filters: RecordsFilterV1 {
            source_time_from: Some(source_time_from),
            source_time_to: Some(source_time_to),
            components: vec![
                ComponentV1::DesktopRenderer,
                ComponentV1::DesktopTauri,
                ComponentV1::DiagnosticsCollector,
                ComponentV1::Anyharness,
                ComponentV1::DesktopWorker,
            ],
            record_classes: vec![RecordClassV1::Detailed, RecordClassV1::Lifecycle],
            severities: Vec::new(),
            names: Vec::new(),
            outcomes: Vec::new(),
            operation_id: None,
            parent_operation_id: None,
            trace_id: None,
            workspace_id: None,
            session_id: None,
            turn_id: None,
            item_id: None,
            request_id: None,
            target_id: None,
            prompt_id: None,
            workflow_id: None,
            error_classification: None,
        },
        record_limit: MAX_EXPORT_RECORDS,
        byte_limit: SUPPORT_EXPORT_BYTES,
        include_health: true,
    }
}

fn validate_support_request(
    request: &ExportRequestV1,
    authorization_id: &str,
) -> Result<(), SupportExportError> {
    validate_export_request(request).map_err(|_| SupportExportError::InvalidRequest)?;
    require_canonical_uuid(authorization_id).map_err(|_| SupportExportError::InvalidRequest)?;
    let filters = &request.filters;
    if request.schema_version != CURRENT_SCHEMA_VERSION
        || request.purpose != ExportPurposeV1::Support
        || request.support_authorization_id.as_deref() != Some(authorization_id)
        || filters.source_time_from.is_none()
        || filters.source_time_to.is_none()
        || filters.components
            != [
                ComponentV1::DesktopRenderer,
                ComponentV1::DesktopTauri,
                ComponentV1::DiagnosticsCollector,
                ComponentV1::Anyharness,
                ComponentV1::DesktopWorker,
            ]
        || filters.record_classes != [RecordClassV1::Detailed, RecordClassV1::Lifecycle]
        || !filters.severities.is_empty()
        || !filters.names.is_empty()
        || !filters.outcomes.is_empty()
        || any_singular_filter(filters)
        || request.record_limit != MAX_EXPORT_RECORDS
        || request.byte_limit != SUPPORT_EXPORT_BYTES
        || !request.include_health
    {
        return Err(SupportExportError::InvalidRequest);
    }
    if !is_exact_support_window(
        filters.source_time_from.as_deref().unwrap_or_default(),
        filters.source_time_to.as_deref().unwrap_or_default(),
    ) {
        return Err(SupportExportError::InvalidRequest);
    }
    Ok(())
}

fn any_singular_filter(filters: &RecordsFilterV1) -> bool {
    filters.operation_id.is_some()
        || filters.parent_operation_id.is_some()
        || filters.trace_id.is_some()
        || filters.workspace_id.is_some()
        || filters.session_id.is_some()
        || filters.turn_id.is_some()
        || filters.item_id.is_some()
        || filters.request_id.is_some()
        || filters.target_id.is_some()
        || filters.prompt_id.is_some()
        || filters.workflow_id.is_some()
        || filters.error_classification.is_some()
}

fn is_exact_support_window(from: &str, to: &str) -> bool {
    let from_text = from;
    let to_text = to;
    let Ok(from) = DateTime::parse_from_rfc3339(from_text) else {
        return false;
    };
    let Ok(to) = DateTime::parse_from_rfc3339(to_text) else {
        return false;
    };
    from.offset().local_minus_utc() == 0
        && to.offset().local_minus_utc() == 0
        && from.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) == from_text
        && to.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) == to_text
        && to.signed_duration_since(from) == chrono::Duration::seconds(SUPPORT_WINDOW_SECONDS)
}

fn require_canonical_uuid(value: &str) -> Result<(), ()> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| ())?;
    (parsed.to_string() == value).then_some(()).ok_or(())
}

mod validation;

#[cfg(test)]
#[path = "support_export_tests.rs"]
mod tests;
