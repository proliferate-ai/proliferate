mod auth;
pub mod config;
mod export;
mod http;
mod ingest_body;
pub mod process;
mod server;
mod state;
mod transport_query;

pub use config::{CollectorConfig, RuntimeLimits};
pub use server::{CollectorServer, ServerError};
pub use state::{CollectorCore, CoreError, IngestResult};

/// The export policy this binary was compiled with: `lifecycle_only` for a
/// customer build, `all` for an internal/dogfood build.
///
/// The desktop release job reads this through the binary's
/// `--print-export-policy` flag and requires `lifecycle_only`, which is the
/// mechanical statement of ruling R-X2: a customer build cannot export the
/// detailed class.
pub fn export_policy_name() -> &'static str {
    export::policy::EXPORT_POLICY.name()
}

/// The compile-time marker literal the release job greps packaged binaries
/// for. Exactly one of `PROLIFERATE_EXPORT_POLICY=lifecycle_only` and
/// `PROLIFERATE_EXPORT_POLICY=all` exists in any given binary.
pub fn export_policy_marker() -> &'static str {
    export::policy::EXPORT_POLICY_MARKER
}
