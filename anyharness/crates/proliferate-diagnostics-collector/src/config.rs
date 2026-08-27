use std::time::Duration;

use proliferate_diagnostics_protocol::v1::limits::RETAINED_RECORD_ARENA_LIMIT_BYTES;

/// Runtime-only caps. They are deliberately below the serialized contract's
/// maxima where concurrent response buffers need independent headroom.
#[derive(Debug, Clone)]
pub struct RuntimeLimits {
    pub retained_bytes: u64,
    pub query_page_bytes: usize,
    pub tail_frame_bytes: usize,
    pub open_connections: usize,
    pub concurrent_handlers: usize,
    pub concurrent_body_parsers: usize,
    pub tail_readers: usize,
    pub tail_queue_frames: usize,
    pub concurrent_exports: usize,
    pub lifecycle_operations: usize,
    pub recorded_gaps: usize,
    pub body_read_deadline: Duration,
    pub shutdown_deadline: Duration,
}

impl Default for RuntimeLimits {
    fn default() -> Self {
        Self {
            // An 8 MiB encoded-record arena leaves independent room under the
            // 50 MiB RSS ceiling for bounded JSON pages and tail frames.
            retained_bytes: 8 * 1024 * 1024,
            query_page_bytes: 1024 * 1024,
            tail_frame_bytes: 1024 * 1024,
            open_connections: 64,
            concurrent_handlers: 8,
            // Only one request may own a body, prepared-record batch, and
            // per-record JSON tree at once.
            concurrent_body_parsers: 1,
            tail_readers: 4,
            tail_queue_frames: 32,
            concurrent_exports: 2,
            lifecycle_operations: 64,
            recorded_gaps: 256,
            // A peer that stalls mid-body holds a body-parse permit and a
            // handler permit for as long as it stays connected, so both are
            // reclaimed on this deadline instead of only on disconnect.
            body_read_deadline: Duration::from_secs(10),
            shutdown_deadline: Duration::from_secs(5),
        }
    }
}

impl RuntimeLimits {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.retained_bytes == 0
            || self.retained_bytes > RETAINED_RECORD_ARENA_LIMIT_BYTES
            || self.query_page_bytes == 0
            || self.query_page_bytes > self.retained_bytes as usize
            || self.tail_frame_bytes == 0
            || self.tail_frame_bytes > self.retained_bytes as usize
            || self.open_connections == 0
            || self.concurrent_handlers == 0
            || self.concurrent_handlers > self.open_connections
            || self.concurrent_body_parsers == 0
            || self.concurrent_body_parsers > self.concurrent_handlers
            || self.tail_readers == 0
            || self.tail_readers > self.concurrent_handlers
            || self.tail_queue_frames == 0
            || self.concurrent_exports == 0
            || self.concurrent_exports > self.concurrent_handlers
            || self.lifecycle_operations == 0
            || self.recorded_gaps == 0
            || self.body_read_deadline.is_zero()
        {
            return Err("invalid diagnostics collector runtime limits");
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct CollectorConfig {
    pub capability: Vec<u8>,
    pub release: String,
    pub environment: String,
    /// Stable identity of this installation, stamped onto exported records as
    /// the `proliferate.install_id` resource attribute.
    ///
    /// It is not a wire-protocol field and no producer can set it. The host
    /// that owns the identity passes it in, so a record cannot claim to come
    /// from an install other than the one whose collector accepted it.
    /// `None` means the host had no identity to give, and the attribute is
    /// then absent rather than empty or invented.
    pub install_id: Option<String>,
    /// The signed-in user's id, stamped onto exported records as the
    /// `proliferate.user_id` resource attribute under the same host-owned
    /// rule as `install_id`: passed in, never derived, absent when signed out.
    pub user_id: Option<String>,
    pub runtime_limits: RuntimeLimits,
    pub auto_ready: bool,
}

impl std::fmt::Debug for CollectorConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CollectorConfig")
            .field("capability", &"[REDACTED]")
            .field("release", &self.release)
            .field("environment", &self.environment)
            .field("install_id", &self.install_id)
            .field("user_id", &self.user_id)
            .field("runtime_limits", &self.runtime_limits)
            .field("auto_ready", &self.auto_ready)
            .finish()
    }
}

impl Drop for CollectorConfig {
    fn drop(&mut self) {
        self.capability.fill(0);
    }
}

impl CollectorConfig {
    pub fn standalone(capability: impl Into<Vec<u8>>) -> Self {
        Self {
            capability: capability.into(),
            release: "standalone".to_owned(),
            environment: "local".to_owned(),
            install_id: None,
            user_id: None,
            runtime_limits: RuntimeLimits::default(),
            auto_ready: true,
        }
    }
}
