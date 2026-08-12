use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream as StdUnixStream;
use std::sync::atomic::Ordering;

use crate::diagnostics_collector::artifact::DiagnosticsArtifactKind;
use crate::diagnostics_collector::client::{contextualize_export_frame, contextualize_health};
use crate::diagnostics_collector::support_export::{
    ConsumedSupportExportPermit, SupportSupervisorExportLease,
};
use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, ExportRequestV1, ExportStreamFrameV1, HealthStatusV1, IngestBatchV1,
    IngestReceiptV1, ProtectedTokenReferenceV1, RecordsPageV1, RecordsQueryV1,
    TokenReferenceKindV1,
};

use super::{
    map_client_error, set_cloexec, unavailable_for_state, validate_renderer_ingest_batch,
    validate_renderer_ingest_receipt, DesktopDiagnosticsHealthV1,
    DesktopDiagnosticsSupervisorStateV1, DiagnosticsCollectorSupervisor, ProtectedChildHandoff,
    ReadyCollectorGeneration, SupervisorExportLease, SupervisorTailLease, SupervisorUnavailable,
};

impl DiagnosticsCollectorSupervisor {
    pub(crate) fn ready_generation(
        &self,
    ) -> Result<ReadyCollectorGeneration, SupervisorUnavailable> {
        if self.shutdown_armed.load(Ordering::Acquire) {
            return Err(SupervisorUnavailable::ShuttingDown);
        }
        let inner = self
            .inner
            .lock()
            .map_err(|_| SupervisorUnavailable::Protocol)?;
        if !matches!(
            &inner.state,
            DesktopDiagnosticsSupervisorStateV1::Ready { .. }
        ) {
            return Err(unavailable_for_state(&inner.state));
        }
        let process = inner
            .process
            .as_ref()
            .ok_or_else(|| unavailable_for_state(&inner.state))?;
        Ok(ReadyCollectorGeneration {
            generation: inner.generation,
            client: process.client(),
            collector_boot_id: process.descriptor().collector_boot_id.clone(),
            restart_count: inner.restart_count,
        })
    }

    pub(crate) async fn health(&self) -> DesktopDiagnosticsHealthV1 {
        let fallback = self.fallback.health();
        let ready = self.ready_generation().ok();
        let collector = match ready.as_ref() {
            Some(ready) => match ready.client.health().await {
                Ok(health)
                    if health.status == HealthStatusV1::Ready
                        && health.schema_version.major == CURRENT_SCHEMA_VERSION.major
                        && health.collector_boot_id == ready.collector_boot_id
                        && self.generation_is_current(ready.generation) =>
                {
                    contextualize_health(health, ready.restart_count, fallback.clone()).ok()
                }
                _ => None,
            },
            None => None,
        };
        let supervisor = self.state();
        let collector = match (ready, collector, &supervisor) {
            (
                Some(ready),
                Some(health),
                DesktopDiagnosticsSupervisorStateV1::Ready {
                    collector_boot_id, ..
                },
            ) if collector_boot_id == &ready.collector_boot_id
                && self.generation_is_current(ready.generation) =>
            {
                Some(health)
            }
            _ => None,
        };
        DesktopDiagnosticsHealthV1 {
            supervisor,
            fallback,
            collector,
        }
    }

    pub(crate) async fn records(
        &self,
        query: &RecordsQueryV1,
    ) -> Result<RecordsPageV1, SupervisorUnavailable> {
        let ready = self.ready_generation()?;
        let page = ready
            .client
            .records(query)
            .await
            .map_err(map_client_error)?;
        self.require_generation(ready.generation)?;
        Ok(page)
    }

    pub(crate) async fn tail(
        &self,
        after_cursor: Option<u64>,
    ) -> Result<SupervisorTailLease, SupervisorUnavailable> {
        let ready = self.ready_generation()?;
        let stream = ready
            .client
            .tail(after_cursor)
            .await
            .map_err(map_client_error)?;
        self.require_generation(ready.generation)?;
        Ok(SupervisorTailLease {
            generation: ready.generation,
            stream,
            generation_changed: self.generation_tx.subscribe(),
            shutdown: self.shutdown_tx.subscribe(),
        })
    }

    pub(crate) async fn export(
        &self,
        request: &ExportRequestV1,
        artifact: DiagnosticsArtifactKind,
    ) -> Result<SupervisorExportLease, SupervisorUnavailable> {
        artifact
            .authorize_external_export(request)
            .map_err(|_| SupervisorUnavailable::CollectorRejected)?;
        let ready = self.ready_generation()?;
        let stream = ready
            .client
            .export(request)
            .await
            .map_err(map_client_error)?;
        self.require_generation(ready.generation)?;
        Ok(SupervisorExportLease {
            generation: ready.generation,
            collector_boot_id: ready.collector_boot_id,
            restart_count: ready.restart_count,
            stream,
            generation_changed: self.generation_tx.subscribe(),
            shutdown: self.shutdown_tx.subscribe(),
        })
    }

    pub(in crate::diagnostics_collector) async fn support_export_query(
        &self,
        request: &ExportRequestV1,
        authority: ConsumedSupportExportPermit,
    ) -> Result<SupportSupervisorExportLease, SupervisorUnavailable> {
        let ready = self.ready_generation()?;
        let stream = ready
            .client
            .export(request)
            .await
            .map_err(map_client_error)?;
        self.require_generation(ready.generation)?;
        Ok(SupportSupervisorExportLease::new(
            SupervisorExportLease {
                generation: ready.generation,
                collector_boot_id: ready.collector_boot_id,
                restart_count: ready.restart_count,
                stream,
                generation_changed: self.generation_tx.subscribe(),
                shutdown: self.shutdown_tx.subscribe(),
            },
            authority,
        ))
    }

    pub(crate) fn contextualize_export(
        &self,
        generation: u64,
        restart_count: u64,
        frame: ExportStreamFrameV1,
    ) -> Result<ExportStreamFrameV1, SupervisorUnavailable> {
        self.require_generation(generation)?;
        if let ExportStreamFrameV1::Health { health } = &frame {
            let expected_boot = self
                .inner
                .lock()
                .ok()
                .and_then(|inner| {
                    inner
                        .process
                        .as_ref()
                        .map(|process| process.descriptor().collector_boot_id.clone())
                })
                .ok_or(SupervisorUnavailable::Replaced)?;
            if health.collector_boot_id != expected_boot {
                return Err(SupervisorUnavailable::Protocol);
            }
        }
        let frame = contextualize_export_frame(frame, restart_count, self.fallback.health())
            .map_err(map_client_error)?;
        self.require_generation(generation)?;
        Ok(frame)
    }

    pub(crate) async fn ingest_renderer(
        &self,
        batch: IngestBatchV1,
    ) -> Result<IngestReceiptV1, SupervisorUnavailable> {
        validate_renderer_ingest_batch(&batch)?;
        let ready = match self.ready_generation() {
            Ok(ready) => ready,
            Err(error @ SupervisorUnavailable::Starting)
            | Err(error @ SupervisorUnavailable::Unsupported)
            | Err(error @ SupervisorUnavailable::Degraded)
            | Err(error @ SupervisorUnavailable::Stopped)
            | Err(error @ SupervisorUnavailable::ShuttingDown) => {
                self.record_pre_dispatch_renderer_batch(&batch);
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        self.dispatch_renderer_batch(&batch, ready).await
    }

    pub(super) async fn dispatch_renderer_batch(
        &self,
        batch: &IngestBatchV1,
        ready: ReadyCollectorGeneration,
    ) -> Result<IngestReceiptV1, SupervisorUnavailable> {
        let receipt = ready.client.ingest(batch).await.map_err(map_client_error)?;
        validate_renderer_ingest_receipt(&receipt, &ready.collector_boot_id)?;
        self.require_generation(ready.generation)?;
        Ok(receipt)
    }

    fn record_pre_dispatch_renderer_batch(&self, batch: &IngestBatchV1) {
        for record in &batch.records {
            if let Ok(serialized) = serde_json::to_string(record) {
                let _ = self.fallback.record_pre_dispatch_renderer(&serialized);
            }
        }
    }

    pub(crate) fn protected_child_handoff(
        &self,
    ) -> Result<ProtectedChildHandoff, SupervisorUnavailable> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| SupervisorUnavailable::Protocol)?;
        if self.shutdown_armed.load(Ordering::Acquire) {
            return Err(SupervisorUnavailable::ShuttingDown);
        }
        if !matches!(
            &inner.state,
            DesktopDiagnosticsSupervisorStateV1::Ready { .. }
        ) {
            return Err(unavailable_for_state(&inner.state));
        }
        let process = inner
            .process
            .as_ref()
            .ok_or_else(|| unavailable_for_state(&inner.state))?;
        let (mut writer, inherited_channel) =
            StdUnixStream::pair().map_err(|_| SupervisorUnavailable::Protocol)?;
        set_cloexec(writer.as_raw_fd()).map_err(|_| SupervisorUnavailable::Protocol)?;
        set_cloexec(inherited_channel.as_raw_fd()).map_err(|_| SupervisorUnavailable::Protocol)?;
        writer
            .write_all(process.capability_bytes())
            .and_then(|_| writer.write_all(b"\n"))
            .map_err(|_| SupervisorUnavailable::Protocol)?;
        let descriptor = ConnectionDescriptorV1 {
            endpoint: process.descriptor().endpoint.clone(),
            token_reference: ProtectedTokenReferenceV1 {
                kind: TokenReferenceKindV1::InheritedFileDescriptor,
                reference: inherited_channel.as_raw_fd().to_string(),
            },
            schema_major: process.descriptor().schema_major,
            collector_boot_id: process.descriptor().collector_boot_id.clone(),
        };
        Ok(ProtectedChildHandoff {
            descriptor,
            inherited_channel,
            generation: inner.generation,
        })
    }
}
