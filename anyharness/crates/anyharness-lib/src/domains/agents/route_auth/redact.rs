//! Length-only `Debug` redaction for secret-bearing route-auth types.
//!
//! Repo law: a secret must NEVER reach print/log/echo output — telemetry is
//! length-only. Deriving `Debug` on a struct with a raw credential field
//! violates that by construction: any `{:?}` (an `assert_eq!` panic today, a
//! `tracing` error path tomorrow) prints the credential. The secret-bearing
//! types in this module tree therefore hand-write `Debug` through these
//! helpers: non-secret fields render verbatim, each secret renders as
//! `"<redacted N bytes>"`, and env maps render their key NAMES (not secrets,
//! and load-bearing for debugging) with redacted values.

use std::collections::BTreeMap;
use std::fmt;

use super::render::RenderedRouteAuth;

/// The length-only marker a secret value renders as in `Debug` output,
/// e.g. `"<redacted 6 bytes>"`.
pub(super) fn redacted(value: &str) -> String {
    format!("<redacted {} bytes>", value.len())
}

/// `Debug` adapter for an env map whose VALUES are credentials: keys render
/// verbatim, values as length-only markers, e.g.
/// `{"CLAUDE_CODE_OAUTH_TOKEN": "<redacted 108 bytes>"}`.
pub(super) struct RedactedEnv<'a>(pub(super) &'a BTreeMap<String, String>);

impl fmt::Debug for RedactedEnv<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_map()
            .entries(self.0.iter().map(|(key, value)| (key, redacted(value))))
            .finish()
    }
}

/// Hand-written so `set`'s values — the composed launch credentials
/// (`ANTHROPIC_AUTH_TOKEN`, `PROLIFERATE_GATEWAY_KEY`, seat tokens, raw api
/// keys) — can never reach `Debug` output; secrets must not be printable,
/// even through a test panic. `remove` and `files` carry no secret (the
/// materialized config bodies reference credentials by env-var NAME only).
/// Lives here rather than in `render.rs` purely for that file's line budget.
impl fmt::Debug for RenderedRouteAuth {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RenderedRouteAuth")
            .field("set", &RedactedEnv(&self.set))
            .field("remove", &self.remove)
            .field("files", &self.files)
            .finish()
    }
}
