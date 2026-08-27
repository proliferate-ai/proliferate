use tracing::info;

use crate::cloud_client::HeartbeatResponse;

/// The tracing target the heartbeat acknowledgement is emitted under. Tests
/// locate the acknowledgement by target and field rather than by message text,
/// so the only readers live behind `cfg(test)`.
#[cfg_attr(not(test), allow(dead_code))]
pub const HEARTBEAT_ACK_TARGET: &str = module_path!();

/// The one per-heartbeat acknowledgement. REL-10 adds the server's snapshot-upload
/// verdict as a typed boolean field here rather than introducing a second
/// per-heartbeat event: the verdict is already part of what the server said on
/// this tick, and expected ineligibility must otherwise be completely silent.
pub fn heartbeat_ack(response: &HeartbeatResponse) {
    info!(
        worker_id = %response.worker_id,
        status = response.status.as_deref(),
        server_time = response.server_time.as_deref(),
        launch_options_upload_allowed = response.launch_options_upload_allowed,
        "cloud heartbeat acknowledged"
    );
}
