use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Utc};
use tokio::time::Instant;

pub(super) trait CoordinatorRuntime: Send + Sync {
    fn utc_now(&self) -> DateTime<Utc>;
    fn instant_now(&self) -> Instant;
    fn new_id(&self) -> String;
    fn sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>>;
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
