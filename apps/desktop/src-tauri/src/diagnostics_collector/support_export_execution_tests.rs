#![cfg(unix)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::time::{Duration, Instant};

use super::tests::{frames, FROM, TO};
use super::*;

fn invocation_with_probe(lifetime: Duration) -> (SupportExportInvocation, Arc<AtomicUsize>) {
    let mut invocation = issue_support_export_for_coordinator(
        &uuid::Uuid::new_v4().to_string(),
        FROM.to_string(),
        TO.to_string(),
        Instant::now() + lifetime,
    )
    .expect("support invocation");
    let drops = Arc::new(AtomicUsize::new(0));
    invocation.permit.drop_probe = Some(AuthorityDropProbe(Arc::clone(&drops)));
    (invocation, drops)
}

fn assert_support_error(
    result: Result<ValidatedSupportExport, SupportExportError>,
    expected: SupportExportError,
) {
    match result {
        Err(actual) => assert_eq!(actual, expected),
        Ok(_) => panic!("support export unexpectedly succeeded"),
    }
}

#[cfg(unix)]
mod unix {
    use std::future;

    use proliferate_diagnostics_protocol::v1::types::{ExportRequestV1, ExportStreamFrameV1};
    use tokio::sync::{mpsc, watch};

    use super::*;

    enum StreamStep {
        Frame(ExportStreamFrameV1),
        Eof,
        Error(CollectorClientError),
    }

    struct FakeStream {
        steps: mpsc::UnboundedReceiver<StreamStep>,
        entered: mpsc::UnboundedSender<()>,
    }

    impl SupportExportFrameStream for FakeStream {
        fn next_frame(&mut self) -> SupportFrameFuture<'_> {
            Box::pin(async move {
                let _ = self.entered.send(());
                match self.steps.recv().await {
                    Some(StreamStep::Frame(frame)) => Ok(Some(frame)),
                    Some(StreamStep::Eof) => Ok(None),
                    Some(StreamStep::Error(error)) => Err(error),
                    None => Err(CollectorClientError::Unavailable),
                }
            })
        }
    }

    struct SignalSenders {
        cancellation: Option<watch::Sender<bool>>,
        opening_shutdown: Option<watch::Sender<bool>>,
        opening_generation: Option<watch::Sender<u64>>,
        lease_shutdown: Option<watch::Sender<bool>>,
        lease_generation: Option<watch::Sender<u64>>,
    }

    struct SignalReceivers {
        cancellation: watch::Receiver<bool>,
        opening_shutdown: watch::Receiver<bool>,
        opening_generation: watch::Receiver<u64>,
        lease_shutdown: watch::Receiver<bool>,
        lease_generation: watch::Receiver<u64>,
    }

    fn signals() -> (SignalSenders, SignalReceivers) {
        let (cancellation_tx, cancellation) = watch::channel(false);
        let (opening_shutdown_tx, opening_shutdown) = watch::channel(false);
        let (opening_generation_tx, opening_generation) = watch::channel(7);
        let (lease_shutdown_tx, lease_shutdown) = watch::channel(false);
        let (lease_generation_tx, lease_generation) = watch::channel(7);
        (
            SignalSenders {
                cancellation: Some(cancellation_tx),
                opening_shutdown: Some(opening_shutdown_tx),
                opening_generation: Some(opening_generation_tx),
                lease_shutdown: Some(lease_shutdown_tx),
                lease_generation: Some(lease_generation_tx),
            },
            SignalReceivers {
                cancellation,
                opening_shutdown,
                opening_generation,
                lease_shutdown,
                lease_generation,
            },
        )
    }

    fn stream() -> (
        mpsc::UnboundedSender<StreamStep>,
        mpsc::UnboundedReceiver<()>,
        FakeStream,
    ) {
        let (step_tx, steps) = mpsc::unbounded_channel();
        let (entered, entered_rx) = mpsc::unbounded_channel();
        (step_tx, entered_rx, FakeStream { steps, entered })
    }

    fn identity_context(
        _generation: u64,
        _restart_count: u64,
        frame: ExportStreamFrameV1,
    ) -> Result<ExportStreamFrameV1, SupervisorUnavailable> {
        Ok(frame)
    }

    async fn execute_immediate(
        admission: Arc<ExportAdmission>,
        invocation: SupportExportInvocation,
        receivers: SignalReceivers,
        stream: FakeStream,
    ) -> Result<ValidatedSupportExport, SupportExportError> {
        execute_support_export(
            admission,
            invocation,
            receivers.cancellation,
            receivers.opening_shutdown,
            receivers.opening_generation,
            move |_request, authority| async move {
                Ok(SupportExportLease {
                    generation: 7,
                    restart_count: 3,
                    stream,
                    generation_changed: receivers.lease_generation,
                    shutdown: receivers.lease_shutdown,
                    _authority: authority,
                })
            },
            identity_context,
        )
        .await
    }

    async fn wait_for_entry(entered: &mut mpsc::UnboundedReceiver<()>) {
        tokio::time::timeout(Duration::from_secs(1), entered.recv())
            .await
            .expect("stream entered before timeout")
            .expect("stream entry signal");
    }

    #[tokio::test]
    async fn shared_broker_admission_and_authority_are_held_through_open_and_stream() {
        let admission = ExportAdmission::shared_capacity_one();
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let collector_request = invocation.request.collector.clone();
        let (signals, receivers) = signals();
        let (step_tx, mut entered, stream) = stream();
        let (opening_tx, mut opening_rx) = mpsc::unbounded_channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let task_admission = Arc::clone(&admission);
        let task = tokio::spawn(execute_support_export(
            task_admission,
            invocation,
            receivers.cancellation,
            receivers.opening_shutdown,
            receivers.opening_generation,
            move |_request, authority| async move {
                let _ = opening_tx.send(());
                let _ = release_rx.await;
                Ok(SupportExportLease {
                    generation: 7,
                    restart_count: 3,
                    stream,
                    generation_changed: receivers.lease_generation,
                    shutdown: receivers.lease_shutdown,
                    _authority: authority,
                })
            },
            identity_context,
        ));

        opening_rx.recv().await.expect("opening entered");
        assert!(Arc::clone(&admission).try_acquire_owned().is_err());
        assert_eq!(drops.load(Ordering::SeqCst), 0);
        release_tx.send(()).expect("release opening");
        wait_for_entry(&mut entered).await;
        assert!(Arc::clone(&admission).try_acquire_owned().is_err());
        assert_eq!(drops.load(Ordering::SeqCst), 0);

        let (manifest, record, health, end) = frames(&collector_request);
        for frame in [manifest, record, health, end] {
            step_tx.send(StreamStep::Frame(frame)).expect("frame");
        }
        step_tx.send(StreamStep::Eof).expect("EOF");
        let export = task.await.expect("execution task").expect("valid export");
        assert_eq!(export.records.len(), 1);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        assert!(Arc::clone(&admission).try_acquire_owned().is_ok());
        drop(signals);
    }

    #[tokio::test]
    async fn initially_cancelled_consumes_authority_without_opening() {
        let admission = ExportAdmission::shared_capacity_one();
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let (signals, receivers) = signals();
        signals
            .cancellation
            .as_ref()
            .expect("cancellation sender")
            .send_replace(true);
        let (_step_tx, mut entered, stream) = stream();
        let result = execute_immediate(admission, invocation, receivers, stream).await;
        assert_support_error(result, SupportExportError::Cancelled);
        assert!(entered.try_recv().is_err());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        drop(signals);
    }

    #[derive(Clone, Copy)]
    enum Interruption {
        Cancellation,
        CancellationSenderClosed,
        Shutdown,
        Generation,
    }

    async fn assert_opening_interruption(interruption: Interruption, expected: SupportExportError) {
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let (mut signals, receivers) = signals();
        let (opening_tx, mut opening_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(execute_support_export(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers.cancellation,
            receivers.opening_shutdown,
            receivers.opening_generation,
            move |_request, authority| async move {
                let _ = opening_tx.send(());
                future::pending::<()>().await;
                drop(authority);
                Err::<SupportExportLease<FakeStream>, _>(SupervisorUnavailable::Protocol)
            },
            identity_context,
        ));
        opening_rx.recv().await.expect("opening entered");
        match interruption {
            Interruption::Cancellation => {
                signals
                    .cancellation
                    .as_ref()
                    .expect("cancellation sender")
                    .send_replace(true);
            }
            Interruption::CancellationSenderClosed => drop(signals.cancellation.take()),
            Interruption::Shutdown => {
                signals
                    .opening_shutdown
                    .as_ref()
                    .expect("shutdown sender")
                    .send_replace(true);
            }
            Interruption::Generation => {
                signals
                    .opening_generation
                    .as_ref()
                    .expect("generation sender")
                    .send_replace(8);
            }
        }
        assert_support_error(task.await.expect("execution task"), expected);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancellation_closure_shutdown_and_replacement_fail_during_opening() {
        assert_opening_interruption(Interruption::Cancellation, SupportExportError::Cancelled)
            .await;
        assert_opening_interruption(
            Interruption::CancellationSenderClosed,
            SupportExportError::Cancelled,
        )
        .await;
        assert_opening_interruption(Interruption::Shutdown, SupportExportError::Cancelled).await;
        assert_opening_interruption(
            Interruption::Generation,
            SupportExportError::CollectorReplaced,
        )
        .await;
    }

    async fn assert_stream_interruption(interruption: Interruption, expected: SupportExportError) {
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let (mut signals, receivers) = signals();
        let (_step_tx, mut entered, stream) = stream();
        let task = tokio::spawn(execute_immediate(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers,
            stream,
        ));
        wait_for_entry(&mut entered).await;
        match interruption {
            Interruption::Cancellation => {
                signals
                    .cancellation
                    .as_ref()
                    .expect("cancellation sender")
                    .send_replace(true);
            }
            Interruption::CancellationSenderClosed => drop(signals.cancellation.take()),
            Interruption::Shutdown => {
                signals
                    .lease_shutdown
                    .as_ref()
                    .expect("shutdown sender")
                    .send_replace(true);
            }
            Interruption::Generation => {
                signals
                    .lease_generation
                    .as_ref()
                    .expect("generation sender")
                    .send_replace(8);
            }
        }
        assert_support_error(task.await.expect("execution task"), expected);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancellation_closure_shutdown_and_replacement_fail_after_lease() {
        assert_stream_interruption(Interruption::Cancellation, SupportExportError::Cancelled).await;
        assert_stream_interruption(
            Interruption::CancellationSenderClosed,
            SupportExportError::Cancelled,
        )
        .await;
        assert_stream_interruption(Interruption::Shutdown, SupportExportError::Cancelled).await;
        assert_stream_interruption(
            Interruption::Generation,
            SupportExportError::CollectorReplaced,
        )
        .await;
    }

    #[tokio::test]
    async fn one_absolute_deadline_covers_opening_and_streaming() {
        let (invocation, drops) = invocation_with_probe(Duration::from_millis(300));
        let (signals, receivers) = signals();
        let (_step_tx, mut entered, stream) = stream();
        let task = tokio::spawn(execute_support_export(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers.cancellation,
            receivers.opening_shutdown,
            receivers.opening_generation,
            move |_request, authority| async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Ok(SupportExportLease {
                    generation: 7,
                    restart_count: 3,
                    stream,
                    generation_changed: receivers.lease_generation,
                    shutdown: receivers.lease_shutdown,
                    _authority: authority,
                })
            },
            identity_context,
        ));
        wait_for_entry(&mut entered).await;
        let result = tokio::time::timeout(Duration::from_millis(250), task)
            .await
            .expect("deadline was not reset after opening")
            .expect("execution task");
        assert_support_error(result, SupportExportError::Deadline);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        drop(signals);
    }

    async fn opening_error(error: SupervisorUnavailable) -> SupportExportError {
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let (signals, receivers) = signals();
        let result = execute_support_export(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers.cancellation,
            receivers.opening_shutdown,
            receivers.opening_generation,
            move |_request, authority| async move {
                drop(authority);
                Err::<SupportExportLease<FakeStream>, _>(error)
            },
            identity_context,
        )
        .await;
        drop(signals);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        match result {
            Err(error) => error,
            Ok(_) => panic!("opening unexpectedly succeeded"),
        }
    }

    async fn stream_error(error: CollectorClientError) -> SupportExportError {
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let (signals, receivers) = signals();
        let (step_tx, _entered, stream) = stream();
        step_tx
            .send(StreamStep::Error(error))
            .expect("stream error");
        let result = execute_immediate(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers,
            stream,
        )
        .await;
        drop(signals);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        match result {
            Err(error) => error,
            Ok(_) => panic!("stream unexpectedly succeeded"),
        }
    }

    #[tokio::test]
    async fn supervisor_and_stream_errors_map_to_closed_support_results() {
        let supervisor_cases = [
            (
                SupervisorUnavailable::Starting,
                SupportExportError::CollectorUnavailable,
            ),
            (
                SupervisorUnavailable::Unsupported,
                SupportExportError::Unsupported,
            ),
            (
                SupervisorUnavailable::Degraded,
                SupportExportError::CollectorUnavailable,
            ),
            (
                SupervisorUnavailable::Stopped,
                SupportExportError::CollectorUnavailable,
            ),
            (
                SupervisorUnavailable::Replaced,
                SupportExportError::CollectorReplaced,
            ),
            (
                SupervisorUnavailable::ShuttingDown,
                SupportExportError::Cancelled,
            ),
            (
                SupervisorUnavailable::CollectorRejected,
                SupportExportError::InvalidStream,
            ),
            (
                SupervisorUnavailable::Deadline,
                SupportExportError::Deadline,
            ),
            (
                SupervisorUnavailable::Protocol,
                SupportExportError::InvalidStream,
            ),
        ];
        for (input, expected) in supervisor_cases {
            assert_eq!(opening_error(input).await, expected);
        }
        let stream_cases = [
            (
                CollectorClientError::Authentication,
                SupportExportError::CollectorUnavailable,
            ),
            (
                CollectorClientError::Rejected,
                SupportExportError::CollectorUnavailable,
            ),
            (
                CollectorClientError::Unavailable,
                SupportExportError::CollectorUnavailable,
            ),
            (CollectorClientError::Deadline, SupportExportError::Deadline),
            (
                CollectorClientError::Protocol,
                SupportExportError::InvalidStream,
            ),
        ];
        for (input, expected) in stream_cases {
            assert_eq!(stream_error(input).await, expected);
        }
    }

    async fn scripted_export(
        steps: Vec<StreamStep>,
    ) -> (Result<ValidatedSupportExport, SupportExportError>, usize) {
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let (signals, receivers) = signals();
        let (step_tx, _entered, stream) = stream();
        for step in steps {
            step_tx.send(step).expect("script step");
        }
        let result = execute_immediate(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers,
            stream,
        )
        .await;
        drop(signals);
        (result, drops.load(Ordering::SeqCst))
    }

    #[tokio::test]
    async fn malformed_and_interrupted_streams_discard_all_partial_frames() {
        let (invocation, _) = invocation_with_probe(Duration::from_secs(25));
        let request = invocation.request.collector.clone();
        drop(invocation);
        let (_, _, health, _) = frames(&request);
        let (malformed, drops) = scripted_export(vec![StreamStep::Frame(health)]).await;
        assert_support_error(malformed, SupportExportError::InvalidStream);
        assert_eq!(drops, 1);

        let (manifest, record, _, _) = frames(&request);
        let (interrupted, drops) = scripted_export(vec![
            StreamStep::Frame(manifest.clone()),
            StreamStep::Frame(record.clone()),
            StreamStep::Error(CollectorClientError::Unavailable),
        ])
        .await;
        assert_support_error(interrupted, SupportExportError::CollectorUnavailable);
        assert_eq!(drops, 1);

        let (partial_eof, drops) = scripted_export(vec![
            StreamStep::Frame(manifest),
            StreamStep::Frame(record),
            StreamStep::Eof,
        ])
        .await;
        assert_support_error(partial_eof, SupportExportError::InvalidStream);
        assert_eq!(drops, 1);
    }

    #[tokio::test]
    async fn end_frame_does_not_escape_until_eof_finishes_the_stream() {
        let (invocation, drops) = invocation_with_probe(Duration::from_secs(25));
        let request = invocation.request.collector.clone();
        let (signals, receivers) = signals();
        let (step_tx, mut entered, stream) = stream();
        let task = tokio::spawn(execute_immediate(
            ExportAdmission::shared_capacity_one(),
            invocation,
            receivers,
            stream,
        ));
        let (manifest, record, health, end) = frames(&request);
        for frame in [manifest, record, health, end] {
            step_tx.send(StreamStep::Frame(frame)).expect("frame");
        }
        for _ in 0..5 {
            wait_for_entry(&mut entered).await;
        }
        assert!(
            !task.is_finished(),
            "End without EOF must not return partial success"
        );
        assert_eq!(drops.load(Ordering::SeqCst), 0);
        step_tx.send(StreamStep::Eof).expect("EOF");
        let export = task.await.expect("execution task").expect("valid export");
        assert_eq!(export.records.len(), 1);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        drop(signals);
    }

    #[test]
    fn injected_opener_accepts_only_the_fixed_collector_request_shape() {
        fn request_shape(request: ExportRequestV1) -> ExportRequestV1 {
            request
        }
        let (invocation, _) = invocation_with_probe(Duration::from_secs(25));
        let request = request_shape(invocation.request.collector.clone());
        assert_eq!(request.record_limit, MAX_EXPORT_RECORDS);
        assert_eq!(request.byte_limit, SUPPORT_EXPORT_BYTES);
        assert!(request.filters.session_id.is_none());
    }
}
