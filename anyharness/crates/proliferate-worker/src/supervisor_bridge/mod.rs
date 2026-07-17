//! Worker-side Supervisor bridge: the mailbox write side + the D5 one-time
//! bridge to Supervisor ownership.
//!
//! On a **supervisor-owned** target (`WorkerConfig.supervisor_update_request_dir`
//! is set) the Worker is only an *observer + writer*. When a heartbeat ack
//! diverges from what the sandbox runs, the Worker writes ONE durable
//! `UpdateRequestV1` into the mailbox for the Supervisor to act on — it never
//! downloads, replaces, kills, or rolls back AnyHarness or itself in this path.
//! The request is idempotent: the `request_id` is derived deterministically from
//! `(component, version)`, so a replayed heartbeat overwrites the same file and
//! the Supervisor activates exactly once.
//!
//! The **D5 bridge** migrates an already-provisioned sandbox (independently
//! `nohup`'d AnyHarness + Worker) to Supervisor ownership exactly once: it writes
//! the Supervisor config, starts the Supervisor detached, confirms it took
//! ownership, and then the bridging Worker exits cleanly so the Supervisor's own
//! Worker child takes over. It is idempotent and crash-safe via marker files
//! (`bridge.started`/`bridge.done`) plus a Supervisor-liveness check that gates
//! the spawn so a second Supervisor is never started. Newly provisioned
//! supervisor-owned targets launch Supervisor-first (server-side) and never
//! reach the spawn branch here — their Worker child sees a live Supervisor and
//! simply continues as a mailbox writer.
//!
//! All request/result shapes, validation, and atomic IO come from the shared
//! crate `proliferate_runtime_update_protocol`; this module builds requests and
//! drives the bridge, but owns no wire schema of its own.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::WorkerConfig;

mod bridge;
mod mailbox;

pub use bridge::{maybe_bridge_to_supervisor, BridgeOutcome};
pub use mailbox::converge_via_mailbox;

/// The single `desired_topology` value the server emits for flag-enabled
/// cloud-sandbox targets. Any other value (or absence) means today's behavior.
pub const SUPERVISOR_OWNED_TOPOLOGY: &str = "supervisor_owned";

/// Whether this Worker is on a supervisor-owned target (routes divergence
/// through the mailbox instead of the legacy in-place swap / self-exec).
pub fn is_supervisor_owned(config: &WorkerConfig) -> bool {
    config.supervisor_update_request_dir.is_some()
}

// ---------------------------------------------------------------------------
// Timestamps (dependency-free RFC3339 UTC — the Worker has no chrono/time dep).
// Shared by the mailbox request builder and the bridge marker writer.
// ---------------------------------------------------------------------------

fn now_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format_rfc3339_utc(secs)
}

/// `<unix seconds>` -> `YYYY-MM-DDThh:mm:ssZ` (UTC). Uses Howard Hinnant's
/// `civil_from_days` so it is exact and needs no date crate.
fn format_rfc3339_utc(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_matches_known_epochs() {
        assert_eq!(format_rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_rfc3339_utc(1_600_000_000), "2020-09-13T12:26:40Z");
        assert_eq!(format_rfc3339_utc(946_684_800), "2000-01-01T00:00:00Z");
    }
}
