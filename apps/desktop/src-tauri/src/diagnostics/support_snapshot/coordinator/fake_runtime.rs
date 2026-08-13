use std::future::Future;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};

use chrono::{DateTime, Utc};
use tokio::sync::Notify;
use tokio::time::{Duration, Instant};

use super::runtime::CoordinatorRuntime;

pub(super) struct FakeRuntime {
    clock: Arc<FakeClock>,
    next_id: Mutex<u64>,
    finish_publication: Arc<AsyncGate>,
    finish_result: BlockingGate,
    finish_timer: Arc<TestEvent>,
    pause_watchdog_deadlines: Arc<AtomicBool>,
    watchdog_release: Arc<TestEvent>,
}

struct FakeClock {
    utc: Mutex<DateTime<Utc>>,
    instant: Mutex<Instant>,
    advanced: Notify,
}

#[derive(Default)]
struct TestEvent {
    fired: AtomicBool,
    notify: Notify,
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
                advanced: Notify::new(),
            }),
            next_id: Mutex::new(0),
            finish_publication: Arc::new(AsyncGate::default()),
            finish_result: BlockingGate::default(),
            finish_timer: Arc::new(TestEvent::default()),
            pause_watchdog_deadlines: Arc::new(AtomicBool::new(false)),
            watchdog_release: Arc::new(TestEvent::default()),
        }
    }

    pub(super) fn advance(&self, duration: Duration) {
        let mut instant = self.clock.instant.lock().expect("fake instant");
        *instant += duration;
        let mut utc = self.clock.utc.lock().expect("fake utc");
        *utc += chrono::Duration::from_std(duration).expect("fake duration");
        self.clock.advanced.notify_waiters();
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
}

fn fake_sleep_until(
    clock: Arc<FakeClock>,
    deadline: Instant,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        loop {
            let advanced = clock.advanced.notified();
            if *clock.instant.lock().expect("fake instant") >= deadline {
                return;
            }
            advanced.await;
        }
    })
}

impl TestEvent {
    fn fire(&self) {
        self.fired.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    async fn wait(&self) {
        loop {
            let notified = self.notify.notified();
            if self.fired.load(Ordering::Acquire) {
                return;
            }
            notified.await;
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
