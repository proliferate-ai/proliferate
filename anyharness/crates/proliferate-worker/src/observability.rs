use tracing::info;

use crate::cloud_client::HeartbeatResponse;

pub fn heartbeat_ack(response: &HeartbeatResponse) {
    info!(
        worker_id = %response.worker_id,
        status = response.status.as_deref(),
        server_time = response.server_time.as_deref(),
        "cloud heartbeat acknowledged"
    );
}
