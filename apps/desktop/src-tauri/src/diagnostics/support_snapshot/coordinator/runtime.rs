use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Utc};
use tokio::time::Instant;

use crate::diagnostics_collector::child_status::NativeChildStatusCapture;

use super::capture::CaptureError;

pub(super) trait CoordinatorRuntime: Send + Sync {
    fn utc_now(&self) -> DateTime<Utc>;
    fn instant_now(&self) -> Instant;
    fn new_id(&self) -> String;
    fn sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>>;

    fn watchdog_sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        self.sleep_until(deadline)
    }

    fn capture_error_override(&self) -> Pin<Box<dyn Future<Output = Option<CaptureError>> + Send>> {
        Box::pin(async { None })
    }

    /// A deterministic downstream child-status response, applied only after the
    /// real support export invocation has been issued, passed the real permit,
    /// and been consumed. Production always returns `None`.
    fn child_status_override(&self) -> Option<NativeChildStatusCapture> {
        None
    }

    fn before_finish_publication(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async {})
    }

    fn before_finish_result_publish(&self) {}

    fn finish_timer_fired(&self) {}

    fn before_preparation_terminal(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async {})
    }

    fn before_submission_terminal(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async {})
    }
}

pub(super) struct SystemCoordinatorRuntime;

impl CoordinatorRuntime for SystemCoordinatorRuntime {
    fn utc_now(&self) -> DateTime<Utc> {
        Utc::now()
    }

    fn instant_now(&self) -> Instant {
        Instant::now()
    }

    fn new_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    fn sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(tokio::time::sleep_until(deadline))
    }
}
