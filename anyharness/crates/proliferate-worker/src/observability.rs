use tracing::info;

use crate::cloud_client::{DesiredVersions, HeartbeatResponse};

pub fn heartbeat_ack(response: &HeartbeatResponse) {
    info!(
        target_id = %response.target_id,
        worker_id = %response.worker_id,
        status = %response.status,
        server_time = %response.server_time,
        "cloud heartbeat acknowledged"
    );
}

pub fn update_requested(desired: &DesiredVersions) {
    info!(
        update_channel = %desired.update_channel,
        anyharness_version = desired.anyharness_version.as_deref(),
        worker_version = desired.worker_version.as_deref(),
        supervisor_version = desired.supervisor_version.as_deref(),
        "cloud requested target runtime update"
    );
}
