use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Timelike, Utc};
use tokio::time::Instant;

use super::capture::CaptureError;

pub(crate) trait CoordinatorRuntime: Send + Sync {
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

/// Drops sub-millisecond nanoseconds from one raw clock read, truncating toward
/// the start of the current millisecond and never rounding. `AutoSi` would
/// otherwise omit `.000` or emit six or nine fractional digits, and the strict
/// collector permit accepts neither spelling. A chrono leap-second read reports
/// `timestamp_subsec_millis()` in `1000..=1999`; clamping to 999 keeps the
/// emitted fraction three digits wide instead of overflowing into the next
/// second.
pub(super) fn truncate_to_milliseconds(value: DateTime<Utc>) -> DateTime<Utc> {
    let milliseconds = value.timestamp_subsec_millis().min(999);
    value
        .with_nanosecond(milliseconds * 1_000_000)
        .unwrap_or(value)
}
