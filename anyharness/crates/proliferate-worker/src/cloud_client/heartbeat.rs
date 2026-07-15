use super::HeartbeatRequest;
use crate::versions;

/// `anyharness_version` is supplied by the caller (the running runtime version,
/// which the store tracks across an in-place swap) rather than read from env
/// here, so a heartbeat reports what actually runs after a swap — the worker's
/// own env is fixed at boot and cannot reflect the swap.
pub fn report(status: impl Into<String>, anyharness_version: Option<String>) -> HeartbeatRequest {
    HeartbeatRequest {
        status: Some(status.into()),
        worker_version: versions::worker_version(),
        anyharness_version,
    }
}
