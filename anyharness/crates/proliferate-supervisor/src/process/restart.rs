use std::time::Duration;

pub fn backoff(seconds: u64) -> Duration {
    Duration::from_secs(seconds.max(1))
}
