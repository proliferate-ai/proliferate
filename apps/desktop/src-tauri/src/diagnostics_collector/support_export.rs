use std::sync::Arc;

#[cfg(unix)]
use std::future::Future;
#[cfg(unix)]
use std::pin::Pin;

use chrono::DateTime;
use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_EXPORT_RECORDS};
#[cfg(unix)]
use proliferate_diagnostics_protocol::v1::types::ExportStreamFrameV1;
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ComponentV1, ExportManifestV1, ExportPurposeV1, ExportRequestV1,
    GapV1, HealthResponseV1, RecordClassV1, RecordsFilterV1,
};
use proliferate_diagnostics_protocol::v1::validation::validate_export_request;
use tokio::sync::watch;
use tokio::time::Instant;

#[cfg(unix)]
use super::client::{CollectorClientError, CollectorJsonLineStream};
use super::export_admission::ExportAdmission;
use super::supervisor::DiagnosticsCollectorSupervisor;
#[cfg(unix)]
use super::supervisor::SupervisorUnavailable;
use validation::SupportExportAccumulator;

const SUPPORT_EXPORT_BYTES: u64 = 16_777_216;
const SUPPORT_WINDOW_SECONDS: i64 = 15 * 60;

/// The closed set of reasons the coordinator-only issuance seam can refuse to
/// mint a support export permit. Crate-private on purpose: no Tauri command,
/// renderer bridge, SDK type, collector protocol message, or server payload may
/// carry it. Variants are evaluated in declaration order: a non-canonical
/// `preparation_id`, a deadline not strictly later than now, a window that is
/// not exact fixed-millisecond UTC `Z` text exactly 900 seconds wide, then the
/// internally constructed request failing an exact support-request invariant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupportExportIssuanceError {
    InvalidPreparationId,
    ExpiredDeadline,
    NoncanonicalWindow,
    RequestInvariant,
}

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

struct SupportExportRequest {
    collector: ExportRequestV1,
    preparation_id: String,
    expires_at: Instant,
}

struct SupportExportPermit {
    authorization_id: String,
    preparation_id: String,
    expires_at: Instant,
    bound_request: ExportRequestV1,
    #[cfg(test)]
    drop_probe: Option<AuthorityDropProbe>,
}

pub(crate) struct SupportExportInvocation {
    request: SupportExportRequest,
    permit: SupportExportPermit,
}

pub(in crate::diagnostics_collector) struct ConsumedSupportExportPermit {
    _authorization_id: String,
    _preparation_id: String,
    _expires_at: Instant,
    #[cfg(test)]
    _drop_probe: Option<AuthorityDropProbe>,
}

#[cfg(test)]
struct AuthorityDropProbe(Arc<std::sync::atomic::AtomicUsize>);

#[cfg(test)]
impl Drop for AuthorityDropProbe {
    fn drop(&mut self) {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

pub(crate) fn issue_support_export_for_coordinator(
    preparation_id: &str,
    source_time_from: String,
    source_time_to: String,
    expires_at: Instant,
) -> Result<SupportExportInvocation, SupportExportIssuanceError> {
    let (request, permit) =
        SupportExportPermit::issue(preparation_id, source_time_from, source_time_to, expires_at)?;
    Ok(SupportExportInvocation { request, permit })
}

impl SupportExportPermit {
    fn issue(
        preparation_id: &str,
        source_time_from: String,
        source_time_to: String,
        expires_at: Instant,
    ) -> Result<(SupportExportRequest, Self), SupportExportIssuanceError> {
        require_canonical_uuid(preparation_id)
            .map_err(|_| SupportExportIssuanceError::InvalidPreparationId)?;
        if expires_at <= Instant::now() {
            return Err(SupportExportIssuanceError::ExpiredDeadline);
        }
        if !is_exact_support_window(&source_time_from, &source_time_to) {
            return Err(SupportExportIssuanceError::NoncanonicalWindow);
        }
        let authorization_id = uuid::Uuid::new_v4().to_string();
        let collector = exact_request(authorization_id.clone(), source_time_from, source_time_to);
        // Test-only corruption of the already-constructed request, so the
        // production validation call below still decides the outcome.
        #[cfg(test)]
        let collector = probe::apply_request_fault(collector);
        validate_support_request(&collector, &authorization_id)
            .map_err(|_| SupportExportIssuanceError::RequestInvariant)?;
        #[cfg(test)]
        probe::record(
            probe::IssuanceStage::Issued,
            collector.filters.source_time_from.as_deref().unwrap_or(""),
            collector.filters.source_time_to.as_deref().unwrap_or(""),
        );
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
            #[cfg(test)]
            drop_probe: None,
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
        #[cfg(test)]
        probe::record(
            probe::IssuanceStage::Consumed,
            request
                .collector
                .filters
                .source_time_from
                .as_deref()
                .unwrap_or(""),
            request
                .collector
                .filters
                .source_time_to
                .as_deref()
                .unwrap_or(""),
        );
        Ok(ConsumedSupportExportPermit {
            _authorization_id: self.authorization_id,
            _preparation_id: self.preparation_id,
            _expires_at: self.expires_at,
            #[cfg(test)]
            _drop_probe: self.drop_probe,
        })
    }
}

#[cfg(unix)]
pub(in crate::diagnostics_collector) struct SupportExportLease<Stream> {
    generation: u64,
    restart_count: u64,
    stream: Stream,
    generation_changed: watch::Receiver<u64>,
    shutdown: watch::Receiver<bool>,
    _authority: ConsumedSupportExportPermit,
}

#[cfg(unix)]
pub(in crate::diagnostics_collector) type SupportSupervisorExportLease =
    SupportExportLease<CollectorJsonLineStream<ExportStreamFrameV1>>;

#[cfg(unix)]
impl SupportExportLease<CollectorJsonLineStream<ExportStreamFrameV1>> {
    pub(in crate::diagnostics_collector) fn new(
        inner: super::supervisor::SupervisorExportLease,
        authority: ConsumedSupportExportPermit,
    ) -> Self {
        Self {
            generation: inner.generation,
            restart_count: inner.restart_count,
            stream: inner.stream,
            generation_changed: inner.generation_changed,
            shutdown: inner.shutdown,
            _authority: authority,
        }
    }
}

#[cfg(unix)]
type SupportFrameFuture<'a> = Pin<
    Box<dyn Future<Output = Result<Option<ExportStreamFrameV1>, CollectorClientError>> + Send + 'a>,
>;

#[cfg(unix)]
trait SupportExportFrameStream: Send {
    fn next_frame(&mut self) -> SupportFrameFuture<'_>;
}

#[cfg(unix)]
impl SupportExportFrameStream for CollectorJsonLineStream<ExportStreamFrameV1> {
    fn next_frame(&mut self) -> SupportFrameFuture<'_> {
        Box::pin(self.next())
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
        invocation: SupportExportInvocation,
        cancellation: watch::Receiver<bool>,
    ) -> Result<ValidatedSupportExport, SupportExportError> {
        execute_support_export(
            self.export_admission(),
            invocation,
            cancellation,
            self.subscribe_shutdown(),
            self.subscribe_generation(),
            |request, authority| async move {
                self.support_export_query(&request, authority).await
            },
            |generation, restart_count, frame| {
                self.contextualize_export(generation, restart_count, frame)
            },
        )
        .await
    }
}

#[cfg(unix)]
async fn execute_support_export<Open, OpenFuture, Stream, Contextualize>(
    admission: Arc<ExportAdmission>,
    invocation: SupportExportInvocation,
    mut cancellation: watch::Receiver<bool>,
    mut opening_shutdown: watch::Receiver<bool>,
    mut opening_generation: watch::Receiver<u64>,
    open: Open,
    mut contextualize: Contextualize,
) -> Result<ValidatedSupportExport, SupportExportError>
where
    Open: FnOnce(ExportRequestV1, ConsumedSupportExportPermit) -> OpenFuture + Send,
    OpenFuture: Future<Output = Result<SupportExportLease<Stream>, SupervisorUnavailable>> + Send,
    Stream: SupportExportFrameStream,
    Contextualize: FnMut(u64, u64, ExportStreamFrameV1) -> Result<ExportStreamFrameV1, SupervisorUnavailable>
        + Send,
{
    let SupportExportInvocation { request, permit } = invocation;
    let authority = permit.consume(&request)?;
    if cancellation_failed_closed(&cancellation) {
        return Err(SupportExportError::Cancelled);
    }
    let _admission = admission
        .try_acquire_owned()
        .map_err(|_| SupportExportError::Busy)?;
    let deadline_at = request.expires_at;
    let deadline = tokio::time::sleep_until(deadline_at);
    tokio::pin!(deadline);

    let opening = open(request.collector.clone(), authority);
    tokio::pin!(opening);
    let mut lease = loop {
        if shutdown_failed_closed(&opening_shutdown) {
            return Err(SupportExportError::Cancelled);
        }
        if watch_sender_closed(&opening_generation) {
            return Err(SupportExportError::CollectorReplaced);
        }
        tokio::select! {
            _ = &mut deadline => return Err(SupportExportError::Deadline),
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    return Err(SupportExportError::Cancelled);
                }
            }
            changed = opening_shutdown.changed() => {
                if changed.is_err() || *opening_shutdown.borrow() {
                    return Err(SupportExportError::Cancelled);
                }
            }
            _ = opening_generation.changed() => {
                return Err(SupportExportError::CollectorReplaced);
            }
            result = &mut opening => break result.map_err(map_supervisor_error)?,
        }
    };
    let mut accumulator = SupportExportAccumulator::new(request.collector)?;

    loop {
        if Instant::now() >= deadline_at {
            return Err(SupportExportError::Deadline);
        }
        if cancellation_failed_closed(&cancellation) || shutdown_failed_closed(&lease.shutdown) {
            return Err(SupportExportError::Cancelled);
        }
        if generation_failed_closed_or_replaced(&lease.generation_changed, lease.generation) {
            return Err(SupportExportError::CollectorReplaced);
        }
        tokio::select! {
            _ = &mut deadline => return Err(SupportExportError::Deadline),
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    return Err(SupportExportError::Cancelled);
                }
            }
            changed = lease.shutdown.changed() => {
                if changed.is_err() || *lease.shutdown.borrow() {
                    return Err(SupportExportError::Cancelled);
                }
            }
            changed = lease.generation_changed.changed() => {
                if changed.is_err()
                    || *lease.generation_changed.borrow() != lease.generation
                {
                    return Err(SupportExportError::CollectorReplaced);
                }
            }
            frame = lease.stream.next_frame() => match frame {
                Ok(Some(frame)) => {
                    let frame = contextualize(
                        lease.generation,
                        lease.restart_count,
                        frame,
                    ).map_err(map_supervisor_error)?;
                    accumulator.push(frame)?;
                }
                Ok(None) => {
                    if Instant::now() >= deadline_at {
                        return Err(SupportExportError::Deadline);
                    }
                    if cancellation_failed_closed(&cancellation)
                        || shutdown_failed_closed(&lease.shutdown)
                    {
                        return Err(SupportExportError::Cancelled);
                    }
                    if generation_failed_closed_or_replaced(
                        &lease.generation_changed,
                        lease.generation,
                    ) {
                        return Err(SupportExportError::CollectorReplaced);
                    }
                    return accumulator.finish();
                }
                Err(error) => return Err(map_stream_error(error)),
            }
        }
    }
}

#[cfg(not(unix))]
impl DiagnosticsCollectorSupervisor {
    pub(crate) async fn export_support_snapshot(
        &self,
        invocation: SupportExportInvocation,
        cancellation: watch::Receiver<bool>,
    ) -> Result<ValidatedSupportExport, SupportExportError> {
        unsupported_support_export(self.export_admission(), invocation, cancellation).await
    }
}

async fn unsupported_support_export(
    admission: Arc<ExportAdmission>,
    invocation: SupportExportInvocation,
    cancellation: watch::Receiver<bool>,
) -> Result<ValidatedSupportExport, SupportExportError> {
    let SupportExportInvocation { request, permit } = invocation;
    let _authority = permit.consume(&request)?;
    if cancellation_failed_closed(&cancellation) {
        return Err(SupportExportError::Cancelled);
    }
    let _admission = admission
        .try_acquire_owned()
        .map_err(|_| SupportExportError::Busy)?;
    Err(SupportExportError::Unsupported)
}

fn cancellation_failed_closed(receiver: &watch::Receiver<bool>) -> bool {
    *receiver.borrow() || watch_sender_closed(receiver)
}

#[cfg(unix)]
fn shutdown_failed_closed(receiver: &watch::Receiver<bool>) -> bool {
    *receiver.borrow() || watch_sender_closed(receiver)
}

#[cfg(unix)]
fn generation_failed_closed_or_replaced(
    receiver: &watch::Receiver<u64>,
    expected_generation: u64,
) -> bool {
    *receiver.borrow() != expected_generation || watch_sender_closed(receiver)
}

fn watch_sender_closed<T>(receiver: &watch::Receiver<T>) -> bool {
    receiver.has_changed().is_err()
}

#[cfg(unix)]
fn map_stream_error(error: CollectorClientError) -> SupportExportError {
    match error {
        CollectorClientError::Deadline => SupportExportError::Deadline,
        CollectorClientError::Protocol => SupportExportError::InvalidStream,
        CollectorClientError::Authentication
        | CollectorClientError::Rejected
        | CollectorClientError::Unavailable => SupportExportError::CollectorUnavailable,
    }
}

#[cfg(unix)]
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
pub(crate) use tests::probe;

#[cfg(test)]
#[path = "support_export_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "support_export_execution_tests.rs"]
mod execution_tests;

#[cfg(test)]
#[path = "support_export_unsupported_tests.rs"]
mod unsupported_tests;
