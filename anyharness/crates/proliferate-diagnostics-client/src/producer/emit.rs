use std::{borrow::Cow, time::Instant};

use proliferate_diagnostics_protocol::v1::{limits::MAX_SAFE_INTEGER, types::SeverityV1};

use super::{
    AdmissionState, CollectorAvailability, ProducerFailureClassification, ProducerInner,
    ResidentRecord,
};
use crate::{DiagnosticsComponent, EmitDisposition};

impl ProducerInner {
    pub(crate) fn try_emit_inner(
        &self,
        input: crate::DetailedDiagnosticInput,
        is_loss_summary: bool,
    ) -> EmitDisposition {
        let return_snapshot = |state: &mut AdmissionState| {
            if is_loss_summary {
                state.return_loss_snapshot();
            }
        };
        let prepared = match self.factory.prepare(input) {
            Ok(prepared) => prepared,
            Err(()) => {
                let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
                return_snapshot(&mut state);
                state.record_loss(ProducerFailureClassification::FilterInvalid);
                return EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid);
            }
        };
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.terminal {
            return_snapshot(&mut state);
            return EmitDisposition::Inactive;
        }
        let Some(sequence) = state.next_sequence else {
            return_snapshot(&mut state);
            state.record_loss(ProducerFailureClassification::SequenceExhausted);
            return EmitDisposition::Dropped(ProducerFailureClassification::SequenceExhausted);
        };
        let record = match self.factory.build(&prepared, sequence) {
            Ok(record) => record,
            Err(()) => {
                return_snapshot(&mut state);
                state.record_loss(ProducerFailureClassification::FilterInvalid);
                return EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid);
            }
        };
        state.last_assigned_sequence = Some(sequence);
        state.next_sequence = sequence
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER);
        let protected = matches!(record.severity, SeverityV1::Warn | SeverityV1::Error)
            || record.detailed.as_ref().is_some_and(|detail| {
                matches!(
                    detail.kind,
                    proliferate_diagnostics_protocol::v1::types::DetailedKindV1::LossSummary
                )
            });
        if state.pressure_suppresses(record.severity, Instant::now(), protected) {
            return_snapshot(&mut state);
            state
                .record_loss_with_sequence(ProducerFailureClassification::Pressure, Some(sequence));
            return EmitDisposition::Dropped(ProducerFailureClassification::Pressure);
        }
        let serialized_bytes = match serde_json::to_vec(&record) {
            Ok(value) => value.len(),
            Err(_) => {
                return_snapshot(&mut state);
                state.record_loss(ProducerFailureClassification::FilterInvalid);
                return EmitDisposition::Dropped(ProducerFailureClassification::FilterInvalid);
            }
        };
        let fallback_reason = state.route_for_current_collector();
        if let Err(reason) = state.make_capacity(serialized_bytes, protected) {
            return_snapshot(&mut state);
            state.record_loss_with_sequence(reason, Some(sequence));
            return EmitDisposition::Dropped(reason);
        }
        state.resident_bytes += serialized_bytes;
        if !protected {
            state.ordinary_records += 1;
            state.ordinary_bytes += serialized_bytes;
        }
        state.queue.push_back(ResidentRecord {
            record,
            serialized_bytes,
            protected,
            is_loss_summary,
            fallback_reason,
            admitted_at: Instant::now(),
        });
        drop(state);
        self.notify.notify_one();
        EmitDisposition::Admitted
    }

    /// Emits at most one aggregate loss summary covering the pending pool.
    /// Constructed only when it is deliverable: a summary that would itself
    /// route to fallback or die with the terminal drain proves nothing and
    /// would loop. Closing the snapshot clears nothing; every non-accepted
    /// outcome returns it to the pending pool.
    pub(crate) fn maybe_emit_loss_summary(&self) {
        use proliferate_diagnostics_protocol::v1::types::{ArgumentValueV1, DetailedKindV1};
        let (counters, total, range) = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            if state.terminal
                || state.pending_loss_total == 0
                || state.open_loss_snapshot.is_some()
                || state.next_sequence.is_none()
                || !matches!(state.collector, CollectorAvailability::Ready(_))
            {
                return;
            }
            let snapshot = state.close_loss_snapshot();
            let claim = (snapshot.counters.clone(), snapshot.total, snapshot.range);
            state.open_loss_snapshot = Some(snapshot);
            claim
        };
        let name: &'static str = match self.component {
            DiagnosticsComponent::AnyHarness => "anyharness.diagnostics.loss",
            DiagnosticsComponent::DesktopWorker => "desktop_worker.diagnostics.loss",
        };
        let mut arguments: Vec<crate::DiagnosticArgument> = counters
            .named_counts()
            .into_iter()
            .filter(|(_, count)| *count > 0)
            .map(|(counter_name, count)| crate::DiagnosticArgument {
                name: Cow::Borrowed(counter_name),
                privacy: crate::DiagnosticPrivacy::Operational,
                value: ArgumentValueV1::Integer(i64::try_from(count).unwrap_or(i64::MAX)),
            })
            .collect();
        if let Some((first, last)) = range {
            for (bound_name, bound) in
                [("first_lost_sequence", first), ("last_lost_sequence", last)]
            {
                arguments.push(crate::DiagnosticArgument {
                    name: Cow::Borrowed(bound_name),
                    privacy: crate::DiagnosticPrivacy::Operational,
                    value: ArgumentValueV1::Integer(i64::try_from(bound).unwrap_or(i64::MAX)),
                });
            }
        }
        let _ = self.try_emit_inner(
            crate::DetailedDiagnosticInput {
                name: Cow::Borrowed(name),
                severity: SeverityV1::Warn,
                kind: DetailedKindV1::LossSummary,
                message: None,
                privacy: crate::DiagnosticPrivacy::Operational,
                arguments,
                correlation: crate::DiagnosticCorrelation::default(),
                error_classification: None,
                stream: None,
                dropped_count: Some(total),
                milestone: None,
            },
            true,
        );
    }

    /// Called only after the drain deadline expires. Every resident record is
    /// counted once; detached in-flight work also makes the fence ineligible.
    pub(super) fn expire_resident_on_shutdown_timeout(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        // This is a one-way authority transition. A blocking syscall already
        // in progress may finish later, but its writer/result cannot rejoin
        // this producer and the caller does not wait a second time. Serializing
        // the transition under admission ownership gives the worker and expiry
        // one unambiguous terminal winner.
        self.fallback.abandon_at_deadline();
        let in_flight = std::mem::take(&mut state.in_flight);
        let drained: Vec<ResidentRecord> = state.queue.drain(..).collect();
        if !in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        // In-flight records were admitted before the queued tail. Preserve that
        // order so a fully owned contiguous loss interval stays exact.
        for record in in_flight {
            if record.is_loss_summary {
                state.return_loss_snapshot();
            }
            state.record_loss_with_sequence(
                ProducerFailureClassification::ShutdownTimeout,
                Some(record.producer_sequence),
            );
        }
        for record in &drained {
            if record.is_loss_summary {
                state.return_loss_snapshot();
            }
            state.record_loss_with_sequence(
                ProducerFailureClassification::ShutdownTimeout,
                Some(record.record.producer_sequence),
            );
        }
        state.resident_bytes = 0;
        state.ordinary_records = 0;
        state.ordinary_bytes = 0;
    }
}
