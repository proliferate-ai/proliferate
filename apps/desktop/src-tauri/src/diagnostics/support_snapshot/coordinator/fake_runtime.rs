use std::future::Future;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};

use chrono::{DateTime, Utc};
use tokio::sync::watch;
use tokio::time::{Duration, Instant};

use super::capture::CaptureError;
use super::runtime::CoordinatorRuntime;

pub(super) struct FakeRuntime {
    clock: Arc<FakeClock>,
    next_id: Mutex<u64>,
    capture_error: Mutex<Option<CaptureError>>,
    capture_result: Arc<AsyncGate>,
    finish_publication: Arc<AsyncGate>,
    finish_result: BlockingGate,
    finish_timer: Arc<TestEvent>,
    preparation_terminal: Arc<AsyncGate>,
    submission_terminal: Arc<AsyncGate>,
    pause_watchdog_deadlines: Arc<AtomicBool>,
    watchdog_release: Arc<TestEvent>,
}

struct FakeClock {
    utc: Mutex<DateTime<Utc>>,
    instant: Mutex<Instant>,
    advanced: watch::Sender<u64>,
}

struct TestEvent {
    fired: watch::Sender<bool>,
}

#[derive(Default)]
struct AsyncGate {
    enabled: AtomicBool,
    reached: TestEvent,
    released: TestEvent,
}

#[derive(Default)]
struct BlockingGate {
    enabled: AtomicBool,
    reached: TestEvent,
    released: AtomicBool,
    mutex: Mutex<()>,
    release: Condvar,
}

impl FakeRuntime {
    pub(super) fn new() -> Self {
        Self {
            clock: Arc::new(FakeClock {
                utc: Mutex::new(
                    DateTime::parse_from_rfc3339("2026-08-12T00:00:00Z")
                        .expect("time")
                        .with_timezone(&Utc),
                ),
                instant: Mutex::new(Instant::now()),
                advanced: watch::channel(0).0,
            }),
            next_id: Mutex::new(0),
            capture_error: Mutex::new(None),
            capture_result: Arc::new(AsyncGate::default()),
            finish_publication: Arc::new(AsyncGate::default()),
            finish_result: BlockingGate::default(),
            finish_timer: Arc::new(TestEvent::default()),
            preparation_terminal: Arc::new(AsyncGate::default()),
            submission_terminal: Arc::new(AsyncGate::default()),
            pause_watchdog_deadlines: Arc::new(AtomicBool::new(false)),
            watchdog_release: Arc::new(TestEvent::default()),
        }
    }

    /// Pins the raw UTC clock the producer reads once per preparation. Used to
    /// drive whole-second, millisecond, microsecond, nanosecond, and
    /// minute/date-boundary cases through the real begin path.
    pub(super) fn set_utc(&self, value: DateTime<Utc>) {
        *self.clock.utc.lock().expect("fake utc") = value;
    }

    pub(super) fn advance(&self, duration: Duration) {
        let mut instant = self.clock.instant.lock().expect("fake instant");
        *instant += duration;
        let mut utc = self.clock.utc.lock().expect("fake utc");
        *utc += chrono::Duration::from_std(duration).expect("fake duration");
        self.clock
            .advanced
            .send_modify(|version| *version = version.wrapping_add(1));
    }

    /// Pins the downstream child-status response to deterministic bounded
    /// values whose `captured_at` is canonical UTC `Z` text. It is applied only
    /// after the real permit was issued and consumed.

    /// Injects a typed capture/issuance result for terminal-mapper and race
    /// tests only. It is never used by the successful begin/finish/stage proof.
    pub(super) fn fail_capture_with(&self, error: CaptureError) {
        *self.capture_error.lock().expect("fake capture error") = Some(error);
    }

    pub(super) fn pause_capture_failure(&self, error: CaptureError) {
        self.fail_capture_with(error);
        self.capture_result.enabled.store(true, Ordering::Release);
    }

    pub(super) fn pause_invalid_capture_result(&self) {
        self.pause_capture_failure(CaptureError::Invalid);
    }

    pub(super) async fn wait_invalid_capture_result(&self) {
        self.capture_result.reached.wait().await;
    }

    pub(super) fn release_invalid_capture_result(&self) {
        self.capture_result.released.fire();
    }

    pub(super) fn pause_finish_publication(&self) {
        self.finish_publication
            .enabled
            .store(true, Ordering::Release);
    }

    pub(super) async fn wait_finish_publication(&self) {
        self.finish_publication.reached.wait().await;
    }

    pub(super) fn release_finish_publication(&self) {
        self.finish_publication.released.fire();
    }

    pub(super) fn pause_finish_result(&self) {
        self.finish_result.enabled.store(true, Ordering::Release);
    }

    pub(super) async fn wait_finish_result(&self) {
        self.finish_result.reached.wait().await;
    }

    pub(super) fn release_finish_result(&self) {
        self.finish_result.released.store(true, Ordering::Release);
        self.finish_result.release.notify_all();
    }

    pub(super) fn pause_watchdog_deadlines(&self) {
        self.pause_watchdog_deadlines.store(true, Ordering::Release);
    }

    pub(super) async fn wait_finish_timer(&self) {
        self.finish_timer.wait().await;
    }

    pub(super) fn pause_preparation_terminal(&self) {
        self.preparation_terminal
            .enabled
            .store(true, Ordering::Release);
    }

    pub(super) async fn wait_preparation_terminal(&self) {
        self.preparation_terminal.reached.wait().await;
    }

    pub(super) fn release_preparation_terminal(&self) {
        self.preparation_terminal.released.fire();
    }

    pub(super) fn pause_submission_terminal(&self) {
        self.submission_terminal
            .enabled
            .store(true, Ordering::Release);
    }

    pub(super) async fn wait_submission_terminal(&self) {
        self.submission_terminal.reached.wait().await;
    }

    pub(super) fn release_submission_terminal(&self) {
        self.submission_terminal.released.fire();
    }
}

impl CoordinatorRuntime for FakeRuntime {
    fn utc_now(&self) -> DateTime<Utc> {
        self.clock.utc.lock().expect("fake utc").to_owned()
    }

    fn instant_now(&self) -> Instant {
        *self.clock.instant.lock().expect("fake instant")
    }

    fn new_id(&self) -> String {
        let mut next = self.next_id.lock().expect("fake id");
        *next += 1;
        uuid::Uuid::from_u128(*next as u128).to_string()
    }

    fn sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        fake_sleep_until(Arc::clone(&self.clock), deadline)
    }

    fn watchdog_sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let sleep = fake_sleep_until(Arc::clone(&self.clock), deadline);
        let paused = Arc::clone(&self.pause_watchdog_deadlines);
        let release = Arc::clone(&self.watchdog_release);
        Box::pin(async move {
            sleep.await;
            if paused.load(Ordering::Acquire) {
                release.wait().await;
            }
        })
    }

    fn capture_error_override(&self) -> Pin<Box<dyn Future<Output = Option<CaptureError>> + Send>> {
        let error = *self.capture_error.lock().expect("fake capture error");
        let gate = Arc::clone(&self.capture_result);
        Box::pin(async move {
            match error {
                Some(error) => {
                    wait_at_gate(gate).await;
                    Some(error)
                }
                None => None,
            }
        })
    }

    fn before_finish_publication(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let gate = Arc::clone(&self.finish_publication);
        Box::pin(async move {
            if gate.enabled.load(Ordering::Acquire) {
                gate.reached.fire();
                gate.released.wait().await;
            }
        })
    }

    fn before_finish_result_publish(&self) {
        self.finish_result.wait_if_enabled();
    }

    fn finish_timer_fired(&self) {
        self.finish_timer.fire();
    }

    fn before_preparation_terminal(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        wait_at_gate(Arc::clone(&self.preparation_terminal))
    }

    fn before_submission_terminal(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        wait_at_gate(Arc::clone(&self.submission_terminal))
    }
}

fn wait_at_gate(gate: Arc<AsyncGate>) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        if gate.enabled.load(Ordering::Acquire) {
            gate.reached.fire();
            gate.released.wait().await;
        }
    })
}

fn fake_sleep_until(
    clock: Arc<FakeClock>,
    deadline: Instant,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        let mut advanced = clock.advanced.subscribe();
        loop {
            if *clock.instant.lock().expect("fake instant") >= deadline {
                return;
            }
            if advanced.changed().await.is_err() {
                return;
            }
        }
    })
}

impl Default for TestEvent {
    fn default() -> Self {
        Self {
            fired: watch::channel(false).0,
        }
    }
}

impl TestEvent {
    fn fire(&self) {
        self.fired.send_replace(true);
    }

    async fn wait(&self) {
        let mut fired = self.fired.subscribe();
        loop {
            if *fired.borrow() {
                return;
            }
            if fired.changed().await.is_err() {
                return;
            }
        }
    }
}

impl BlockingGate {
    fn wait_if_enabled(&self) {
        if !self.enabled.load(Ordering::Acquire) {
            return;
        }
        self.reached.fire();
        let mut guard = self.mutex.lock().expect("finish-result gate");
        while !self.released.load(Ordering::Acquire) {
            guard = self.release.wait(guard).expect("finish-result gate");
        }
    }
}
