//! The export handle every build compiles.
//!
//! Compiling this module is necessary but not sufficient: a binary still
//! exports nothing until a destination is configured out of band, and it never
//! learns a provider identity from this crate.
//!
//! [`ExporterHandle::offer`] is the first of the two policy fences. It runs on
//! the ingest path with the record class already in hand, so a class this
//! build may not export never enters the queue at all.

use std::sync::Arc;
use std::sync::Mutex;

use proliferate_diagnostics_protocol::v1::types::{ExporterHealthV1, RecordClassV1};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::classification::ExportFailure;
use super::policy::EXPORT_POLICY;
use super::target::{self, TargetConfiguration};
use super::worker::{ExporterMetrics, Worker, QUEUE_RECORDS, SHUTDOWN_FLUSH};

/// Where an accepted record goes on its way out of the process.
enum Sink {
    /// No destination configured: nothing is exported and nothing is lost.
    Off,
    /// A destination was requested but could not be used.
    Misconfigured,
    Queue(mpsc::Sender<Arc<[u8]>>),
}

pub(crate) struct ExporterHandle {
    sink: Sink,
    metrics: Arc<ExporterMetrics>,
    pending: Mutex<Option<Worker>>,
    running: Mutex<Option<(watch::Sender<bool>, JoinHandle<()>)>>,
}

impl ExporterHandle {
    /// `install_id` is the host-supplied identity of this installation. It is
    /// carried to the encoder rather than read from the environment, because
    /// only the host that owns the identity may assert it.
    pub(crate) fn from_environment(install_id: Option<String>, user_id: Option<String>) -> Self {
        let metrics = Arc::new(ExporterMetrics::default());
        match target::from_environment() {
            TargetConfiguration::Absent => Self::inert(Sink::Off, metrics),
            TargetConfiguration::Invalid(_reason) => {
                // A destination was asked for and cannot be honored. Health
                // reports it; startup is never failed for observability.
                metrics.mark_degraded(ExportFailure::InvalidConfiguration);
                Self::inert(Sink::Misconfigured, metrics)
            }
            TargetConfiguration::Configured(target) => {
                let (sender, receiver) = mpsc::channel(QUEUE_RECORDS);
                let worker =
                    Worker::new(receiver, target, Arc::clone(&metrics), install_id, user_id);
                Self {
                    sink: Sink::Queue(sender),
                    metrics,
                    pending: Mutex::new(Some(worker)),
                    running: Mutex::new(None),
                }
            }
        }
    }

    fn inert(sink: Sink, metrics: Arc<ExporterMetrics>) -> Self {
        Self {
            sink,
            metrics,
            pending: Mutex::new(None),
            running: Mutex::new(None),
        }
    }

    /// Starts the export task. Called once from collector startup, inside the
    /// runtime; a core built without it simply never exports.
    pub(crate) fn spawn(&self) {
        let Some(worker) = self.pending.lock().ok().and_then(|mut slot| slot.take()) else {
            return;
        };
        let (stop_tx, stop_rx) = watch::channel(false);
        let task = tokio::spawn(worker.run(stop_rx));
        if let Ok(mut running) = self.running.lock() {
            *running = Some((stop_tx, task));
        }
    }

    /// Offers one accepted record. This runs on the ingest path, so it must
    /// never block, allocate a queue, or fail an accepted record.
    ///
    /// A class this build may not export is refused here, before the queue,
    /// and is deliberately NOT counted as a drop: the record was accepted,
    /// retained, and stays queryable locally. Nothing was lost, this build
    /// simply does not export that class. Counting it would make exporter
    /// health report a customer collector as permanently lossy.
    #[inline]
    pub(crate) fn offer(&self, class: RecordClassV1, encoded: &Arc<[u8]>) {
        if !EXPORT_POLICY.admits_class(class) {
            return;
        }
        match &self.sink {
            Sink::Off => {}
            Sink::Misconfigured => self.metrics.note_dropped(1),
            Sink::Queue(sender) => {
                if sender.try_send(Arc::clone(encoded)).is_err() {
                    self.metrics.note_dropped(1);
                }
            }
        }
    }

    pub(crate) fn health(&self) -> ExporterHealthV1 {
        self.metrics.health()
    }

    pub(crate) async fn shutdown(&self) {
        let Some((stop, task)) = self.running.lock().ok().and_then(|mut slot| slot.take()) else {
            return;
        };
        let _ = stop.send(true);
        if tokio::time::timeout(SHUTDOWN_FLUSH, task).await.is_err() {
            // The bounded final flush is a courtesy, never a shutdown gate.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proliferate_diagnostics_protocol::v1::types::ExporterStateV1;

    fn encoded() -> Arc<[u8]> {
        Arc::from(b"{}".to_vec().into_boxed_slice())
    }

    /// The centerpiece of the customer export: a detailed record cannot reach
    /// the export queue, so it cannot reach the encoder, the HTTP client, or
    /// the wire. Detailed is the only class that can carry free text
    /// (`DetailedDiagnosticV1` owns `message`, `stream`, `milestone`), so this
    /// one refusal is what keeps prompt text, tool output, and file paths on
    /// the machine.
    ///
    /// Negative control: delete the `admits_class` guard in
    /// [`ExporterHandle::offer`] and this test fails with 512 queued records.
    #[test]
    #[cfg(not(feature = "internal-dogfood-export"))]
    fn a_customer_build_never_queues_a_detailed_record() {
        let metrics = Arc::new(ExporterMetrics::default());
        let (sender, mut receiver) = mpsc::channel(QUEUE_RECORDS);
        let handle = queued(sender, Arc::clone(&metrics));
        for _ in 0..QUEUE_RECORDS + 32 {
            handle.offer(RecordClassV1::Detailed, &encoded());
        }
        assert!(
            receiver.try_recv().is_err(),
            "a detailed record reached the customer export queue"
        );
        // A filtered class is not a loss: the record is accepted, retained,
        // and locally queryable. Counting it would make every customer
        // collector report itself permanently lossy.
        assert_eq!(handle.health().dropped_records, 0);
    }

    #[test]
    #[cfg(not(feature = "internal-dogfood-export"))]
    fn a_customer_build_queues_a_lifecycle_record() {
        let metrics = Arc::new(ExporterMetrics::default());
        let (sender, mut receiver) = mpsc::channel(QUEUE_RECORDS);
        let handle = queued(sender, Arc::clone(&metrics));
        handle.offer(RecordClassV1::Lifecycle, &encoded());
        assert!(receiver.try_recv().is_ok());
        assert_eq!(handle.health().dropped_records, 0);
    }

    #[test]
    #[cfg(feature = "internal-dogfood-export")]
    fn a_dogfood_build_queues_both_classes() {
        let metrics = Arc::new(ExporterMetrics::default());
        let (sender, mut receiver) = mpsc::channel(QUEUE_RECORDS);
        let handle = queued(sender, Arc::clone(&metrics));
        handle.offer(RecordClassV1::Lifecycle, &encoded());
        handle.offer(RecordClassV1::Detailed, &encoded());
        assert!(receiver.try_recv().is_ok());
        assert!(receiver.try_recv().is_ok());
        assert_eq!(handle.health().dropped_records, 0);
    }

    #[test]
    fn an_unconfigured_build_exports_nothing_and_loses_nothing() {
        let handle = ExporterHandle::inert(Sink::Off, Arc::new(ExporterMetrics::default()));
        for _ in 0..64 {
            handle.offer(RecordClassV1::Lifecycle, &encoded());
        }
        let health = handle.health();
        assert_eq!(health.state, ExporterStateV1::Disabled);
        assert_eq!(health.dropped_records, 0);
    }

    #[test]
    fn a_misconfigured_destination_degrades_and_counts_every_lost_record() {
        let metrics = Arc::new(ExporterMetrics::default());
        metrics.mark_degraded(ExportFailure::InvalidConfiguration);
        let handle = ExporterHandle::inert(Sink::Misconfigured, metrics);
        for _ in 0..5 {
            handle.offer(RecordClassV1::Lifecycle, &encoded());
        }
        let health = handle.health();
        assert_eq!(health.state, ExporterStateV1::Degraded);
        assert_eq!(health.dropped_records, 5);
        assert_eq!(
            health.last_error_classification.as_deref(),
            Some("invalid_configuration")
        );
    }

    #[test]
    fn a_full_queue_drops_the_offered_record_instead_of_growing() {
        let metrics = Arc::new(ExporterMetrics::default());
        let (sender, _receiver) = mpsc::channel(QUEUE_RECORDS);
        let handle = queued(sender, Arc::clone(&metrics));
        for _ in 0..QUEUE_RECORDS + 32 {
            handle.offer(RecordClassV1::Lifecycle, &encoded());
        }
        assert_eq!(handle.health().dropped_records, 32);
    }

    fn queued(sender: mpsc::Sender<Arc<[u8]>>, metrics: Arc<ExporterMetrics>) -> ExporterHandle {
        ExporterHandle {
            sink: Sink::Queue(sender),
            metrics,
            pending: Mutex::new(None),
            running: Mutex::new(None),
        }
    }
}
