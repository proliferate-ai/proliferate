//! Seat tier-1 trial: one credential-scoped `POST /v1/messages` per mint
//! (founder ruling 2026-08-27), so a seat's evidence is real instead of
//! inferred from file presence or an un-credentialed probe.
//!
//! Shape and honesty rules:
//!
//! - **The request** mirrors slice 4's usage probe byte-for-byte (see
//!   `server/proliferate/integrations/anthropic.py` on that branch): the
//!   cheapest current model, `max_tokens: 1`, a one-character user message,
//!   `anthropic-version: 2023-06-01`, `anthropic-beta: oauth-2025-04-20`, the
//!   token on `Authorization: Bearer`. `/v1/messages` is the one endpoint a
//!   `user:inference`-scoped setup token is provably allowed to call —
//!   `GET /v1/models` may be outside the scope and would reject GOOD seats.
//!   When slice 4 lands, its per-seat usage probe and this trial are the same
//!   call in the limit and should unify (recorded on #2254; do not add a
//!   second burner).
//! - **Classification**: 2xx → verified; 401/403 → rejected (the credential is
//!   dead); anything else — transport error, timeout, 5xx, 429 — records
//!   NOTHING, so the derived display stays the honest un-verified state
//!   rather than claiming either way.
//! - **Cadence**: exactly one trial, at mint completion (the one-time claim
//!   handoff). No timer, no retry — the ordinary launch probe remains the
//!   spec's verification mechanism; this trial only makes the credential's
//!   evidence slot truthful in the window before/despite it.
//! - **Secrets**: the token exists in the request headers only. This module
//!   logs nothing but the verdict and harness kind, and it scrubs its owned
//!   copy of the token on every path (`scripts/check_agent_auth_secret_logs.py`
//!   scans this file; keep it that way).
//! - **Scope guard**: a verdict is folded into the readiness facts only while
//!   the harness's APPLIED route actually selects a seat source. A stale seat
//!   verdict can therefore never color a gateway, BYOK, or native state —
//!   native is a permanently supported method (founder ruling) and must not
//!   be degraded by seat machinery.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};

use super::state::{load_state_file, SOURCE_KIND_SEAT};

/// Where the trial's `/v1/messages` call goes in production.
pub const SEAT_TRIAL_BASE_URL: &str = "https://api.anthropic.com";

/// Bounded like the gateway probe: an unreachable API must not pin the claim
/// path's spawned task (the claim response itself never waits on the trial).
const SEAT_TRIAL_TIMEOUT: Duration = Duration::from_secs(10);

/// The cheapest current model — one output token buys the auth verdict.
/// Identical to slice 4's `_USAGE_PROBE_MODEL` on purpose (convergence).
const SEAT_TRIAL_MODEL: &str = "claude-haiku-4-5";

/// Subscription OAuth tokens ride `Authorization: Bearer` and require this
/// beta flag; `x-api-key` is the wrong header for them.
const OAUTH_BETA: &str = "oauth-2025-04-20";

/// What one trial concluded about the credential it exercised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatTrialVerdict {
    /// The API answered 2xx: the token authenticates.
    Verified,
    /// The API answered 401/403: the token is dead. The seat STAYS SAVED
    /// (spec flow 2: a failed verification never deletes the row); only the
    /// displayed state goes to Expired.
    Rejected,
}

#[derive(Debug, Clone, Copy)]
struct SeatTrialRecord {
    verdict: SeatTrialVerdict,
    at: DateTime<Utc>,
}

/// In-memory, per-harness ledger of the latest seat-trial verdict. Memory-only
/// on purpose: a restart forgets the verdict and the display honestly returns
/// to un-verified until the next mint or probe — no verdict is ever persisted
/// next to the credential it judges.
pub struct SeatTrialLedger {
    base_url: String,
    records: Mutex<HashMap<String, SeatTrialRecord>>,
}

impl Default for SeatTrialLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl SeatTrialLedger {
    pub fn new() -> Self {
        Self::with_base_url(SEAT_TRIAL_BASE_URL)
    }

    /// Test seam: point the trial at a local server.
    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            records: Mutex::new(HashMap::new()),
        }
    }

    /// Run one trial for `harness_kind` with the just-claimed token and record
    /// the verdict. Takes the token BY VALUE and scrubs it on every path —
    /// the caller's clone dies here.
    ///
    /// Any earlier verdict is cleared first: it judged a PREVIOUS token, and
    /// an inconclusive outcome for the new one must leave absence, not a stale
    /// answer about a credential that no longer rides this route.
    pub async fn run_trial(&self, harness_kind: &str, token: String) {
        self.lock().remove(harness_kind);
        let verdict = trial_request(&self.base_url, &token).await;
        scrub_secret(token);
        if let Some(verdict) = verdict {
            tracing::info!(harness_kind, ?verdict, "seat tier-1 trial verdict");
            self.lock().insert(
                harness_kind.to_string(),
                SeatTrialRecord {
                    verdict,
                    at: Utc::now(),
                },
            );
        } else {
            tracing::info!(
                harness_kind,
                "seat tier-1 trial inconclusive; recording nothing"
            );
        }
    }

    /// The verdict to fold into the harness's readiness facts, with the age of
    /// the check — or `None` when there is no verdict or the harness's applied
    /// route does not currently select a seat (the scope guard above).
    pub fn verdict_for_applied_seat(
        &self,
        runtime_home: &Path,
        harness_kind: &str,
        now: DateTime<Utc>,
    ) -> Option<(SeatTrialVerdict, i64)> {
        let record = *self.lock().get(harness_kind)?;
        if !applied_source_is_seat(runtime_home, harness_kind) {
            return None;
        }
        let age_seconds = now.signed_duration_since(record.at).num_seconds().max(0);
        Some((record.verdict, age_seconds))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SeatTrialRecord>> {
        self.records.lock().expect("seat trial ledger poisoned")
    }
}

/// Does the harness's applied state document select a seat source right now?
fn applied_source_is_seat(runtime_home: &Path, harness_kind: &str) -> bool {
    matches!(
        load_state_file(runtime_home),
        Ok(Some(state))
            if state
                .sources_for(harness_kind)
                .is_some_and(|sources| sources.iter().any(|s| s.kind == SOURCE_KIND_SEAT))
    )
}

/// The one-token `/v1/messages` call, classified. `None` is "learned nothing".
async fn trial_request(base_url: &str, token: &str) -> Option<SeatTrialVerdict> {
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    // `no_proxy`: the URL is fixed, so no HTTPS_PROXY from the environment may
    // interpose on the token's path (mirrors slice 4's `trust_env=False`).
    let client = reqwest::Client::builder()
        .timeout(SEAT_TRIAL_TIMEOUT)
        .no_proxy()
        .build()
        .ok()?;
    let body = serde_json::json!({
        "model": SEAT_TRIAL_MODEL,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "." }],
    });
    let response = client
        .post(&url)
        .bearer_auth(token)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", OAUTH_BETA)
        .json(&body)
        .send()
        .await
        .ok()?;
    match response.status().as_u16() {
        200..=299 => Some(SeatTrialVerdict::Verified),
        401 | 403 => Some(SeatTrialVerdict::Rejected),
        _ => None,
    }
}

/// Best-effort scrub of this module's owned token copy: volatile zero over the
/// full capacity plus a fence, same stance as the mint capture's `wipe_bytes`
/// (a plain drop leaves the bytes readable in freed memory).
fn scrub_secret(secret: String) {
    let mut bytes = secret.into_bytes();
    let capacity = bytes.capacity();
    let ptr = bytes.as_mut_ptr();
    // SAFETY: `ptr..ptr+capacity` is this Vec's own live allocation, `u8` has
    // no validity invariants, and the length is set to 0 first so no safe
    // reader can observe the overwritten region as initialized contents.
    unsafe {
        bytes.set_len(0);
        for offset in 0..capacity {
            std::ptr::write_volatile(ptr.add(offset), 0);
        }
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    drop(bytes);
}
