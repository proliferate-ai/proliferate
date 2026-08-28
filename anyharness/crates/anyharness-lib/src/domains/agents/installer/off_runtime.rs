//! Async/sync boundary for the CLI installer.
//!
//! The installer downloads artifacts with `reqwest::blocking` (see
//! [`super::downloads`]), which builds and then drops its own Tokio runtime. A
//! Tokio runtime cannot be dropped from within a runtime worker thread — doing
//! so panics with *"Cannot drop a runtime in a context where blocking is not
//! allowed"* (`tokio .../runtime/blocking/shutdown.rs`).
//!
//! `anyharness install-agents` runs under `#[tokio::main]`, so calling the
//! synchronous installer directly on the async runtime hits exactly that panic
//! the first time an artifact actually has to be fetched over HTTP. It stayed
//! latent until a native pin bump forced a re-download (the codex
//! `rust-v0.144.5 → rust-v0.147.0` move in the Forks ADR rung-1 catalog flip).
//!
//! The fix is to hop the synchronous installer onto a dedicated blocking thread
//! via [`tokio::task::spawn_blocking`] before it touches `reqwest::blocking`.
//! Blocking-pool threads are not runtime workers, so the nested blocking
//! runtime is created and dropped cleanly there.

use anyhow::Result;

/// Run the synchronous installer closure off the async runtime.
///
/// Safe to call from within `#[tokio::main]`: the closure executes on a
/// blocking-pool thread, so any `reqwest::blocking` client it builds (and
/// drops) does not violate Tokio's no-runtime-drop-in-async-context rule.
pub async fn run_installer_off_runtime<F>(f: F) -> Result<()>
where
    F: FnOnce() -> Result<()> + Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(inner) => inner,
        Err(join_error) => Err(anyhow::anyhow!(
            "install-agents worker thread panicked: {join_error}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression pin for the `install-agents` crash.
    ///
    /// Building a `reqwest::blocking` client is the exact operation that
    /// panicked under `anyharness install-agents` (frame `ClientBuilder::build`
    /// → `download_binary_inner`, `downloads.rs:60`): the blocking client spins
    /// and drops its own runtime, which aborts when done on a Tokio worker
    /// thread. Running that build through [`run_installer_off_runtime`] inside
    /// a Tokio runtime must NOT panic.
    ///
    /// Negative control (manual): replace the `run_installer_off_runtime(...)`
    /// call below with a direct `reqwest::blocking::Client::builder().build()`
    /// and this test panics with *"Cannot drop a runtime in a context where
    /// blocking is not allowed"* at `tokio .../blocking/shutdown.rs` — i.e. the
    /// pre-fix behavior.
    #[tokio::test]
    async fn blocking_reqwest_build_survives_off_runtime() {
        let outcome = run_installer_off_runtime(|| {
            reqwest::blocking::Client::builder()
                .build()
                .map(|_client| ())
                .map_err(|error| anyhow::anyhow!("reqwest blocking client build failed: {error}"))
        })
        .await;

        assert!(
            outcome.is_ok(),
            "off-runtime installer boundary must not panic building a blocking client: {outcome:?}"
        );
    }
}
