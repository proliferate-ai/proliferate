//! The real runner, with a real child process: cancellation and timeout must kill
//! the child AND clean the scratch, in that order.
//!
//! This is the one test in the suite that spawns an actual `tokio::process::Child`,
//! because the property under test is a fact about WHICH FRAME owns it. A fake
//! runner cannot exercise it: the bug being guarded against is that dropping the
//! caller's future drops only a `oneshot` receiver, so `kill_on_drop` never fires
//! and the harness leaks — while the caller's `drop(materialized)` deletes the
//! config dir out from under the still-running child.
//!
//! The child is a shell script pointed at through the documented
//! `ANYHARNESS_<KIND>_AGENT_PROGRAM` override, not a real harness: it never speaks
//! ACP, which is precisely why the probe hangs long enough to be cancelled.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::probe::{AcpProbeRunner, ProbeError, ProbeRequest, ProbeRunner};
use super::test_support::{gateway_state, TempRuntimeHome};
use crate::app::test_support::lock_env;
use crate::domains::agents::route_auth::{
    probe_materialization::probe_auth_material_for_server, GatewayModelPlan,
};

/// Restores an override env var on drop, so a panicking test cannot poison the
/// crate-wide environment for its siblings.
struct OverrideGuard {
    name: String,
    previous: Option<std::ffi::OsString>,
}

impl OverrideGuard {
    fn set(name: &str, value: &Path) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self {
            name: name.to_string(),
            previous,
        }
    }
}

impl Drop for OverrideGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var(&self.name, value),
            None => std::env::remove_var(&self.name),
        }
    }
}

/// A script that (a) proves it started by writing its pid, (b) keeps rewriting a
/// heartbeat inside the probe scratch, and (c) records an error if that write ever
/// fails — which is exactly what happens if the scratch is deleted while it runs.
fn write_heartbeat_script(dir: &Path, pid_file: &Path, error_file: &Path) -> std::path::PathBuf {
    let script = dir.join("fake-agent.sh");
    let body = format!(
        r#"#!/bin/sh
echo $$ > "{pid}"
# The heartbeat lives in the CWD, which the runner sets to the probe scratch's
# workspace. If the scratch vanishes while we run, this write fails and we say so.
while true; do
  if ! echo tick > ./heartbeat 2>/dev/null; then
    echo "scratch vanished while the child was alive" >> "{errors}"
  fi
  sleep 0.05
done
"#,
        pid = pid_file.display(),
        errors = error_file.display(),
    );
    std::fs::write(&script, body).expect("write script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("chmod script");
    }
    script
}

fn request(home: &TempRuntimeHome, timeout: Duration) -> ProbeRequest {
    let material =
        probe_auth_material_for_server(home.path(), "opencode", None).expect("material");
    ProbeRequest {
        harness_kind: "opencode".to_string(),
        material,
        plan: GatewayModelPlan {
            models: vec!["m-1".to_string()],
            ..Default::default()
        },
        runtime_home: home.path().to_path_buf(),
        per_probe_timeout: timeout,
    }
}

fn scratch_roots(home: &TempRuntimeHome) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(home.path().join("agent-auth-probe"))
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default()
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    // SAFETY: signal 0 performs error checking only.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

/// Wait for a condition, polling briefly. Bounded so a genuine failure fails the
/// test rather than hanging it.
async fn eventually(mut predicate: impl FnMut() -> bool) -> bool {
    for _ in 0..200 {
        if predicate() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    false
}

fn read_pid(pid_file: &Path) -> Option<u32> {
    std::fs::read_to_string(pid_file)
        .ok()?
        .trim()
        .parse::<u32>()
        .ok()
}

/// T-33 — **cancellation kills the child and cleans up in the right order.**
///
/// Three assertions, and the third is the one rev 1 of the design violated:
/// 1. the child pid is dead within a bounded wait;
/// 2. the scratch root is gone;
/// 3. the child never observed its scratch disappearing while it was alive.
#[cfg(unix)]
#[tokio::test]
async fn cancelling_a_probe_kills_the_child_then_removes_the_scratch() {
    let _env = lock_env();
    let home = TempRuntimeHome::new("cancel");
    home.write_state_json(&gateway_state(3, &[("opencode", "sk-vk")]));
    let pid_file = home.path().join("child.pid");
    let error_file = home.path().join("child.errors");
    let script = write_heartbeat_script(home.path(), &pid_file, &error_file);
    let _override = OverrideGuard::set("ANYHARNESS_OPENCODE_AGENT_PROGRAM", &script);

    let runner: Arc<dyn ProbeRunner> = Arc::new(AcpProbeRunner);
    // A timeout far longer than the test: cancellation, not the timeout, must be
    // what ends this probe.
    let probe_request = request(&home, Duration::from_secs(600));
    let handle = tokio::spawn(async move {
        let _ = runner.run(probe_request).await;
    });

    assert!(
        eventually(|| read_pid(&pid_file).is_some()).await,
        "the fake agent must actually start"
    );
    let pid = read_pid(&pid_file).expect("child pid");
    assert!(pid_is_alive(pid), "the child is running before cancellation");
    assert!(
        !scratch_roots(&home).is_empty(),
        "the probe materialized a scratch root"
    );

    // Cancel by dropping the future (aborting the task that holds it).
    handle.abort();
    let _ = handle.await;

    assert!(
        eventually(|| !pid_is_alive(pid)).await,
        "cancellation must kill the child, not leak it"
    );
    assert!(
        eventually(|| scratch_roots(&home).is_empty()).await,
        "cancellation must remove the scratch root"
    );
    assert!(
        !error_file.exists(),
        "the child must never have seen its scratch vanish while alive: {:?}",
        std::fs::read_to_string(&error_file).unwrap_or_default()
    );
}

/// T-34 — the timeout path, same shape: the child dies, the scratch goes, the
/// order holds, and the error is reported as a timeout rather than a generic
/// failure.
#[cfg(unix)]
#[tokio::test]
async fn a_timed_out_probe_kills_its_child_and_reports_a_timeout() {
    let _env = lock_env();
    let home = TempRuntimeHome::new("timeout-real");
    home.write_state_json(&gateway_state(3, &[("opencode", "sk-vk")]));
    let pid_file = home.path().join("child.pid");
    let error_file = home.path().join("child.errors");
    let script = write_heartbeat_script(home.path(), &pid_file, &error_file);
    let _override = OverrideGuard::set("ANYHARNESS_OPENCODE_AGENT_PROGRAM", &script);

    let runner = Arc::new(AcpProbeRunner);
    let outcome = runner.run(request(&home, Duration::from_millis(600))).await;

    assert!(
        matches!(outcome, Err(ProbeError::Timeout)),
        "expected a timeout, got {outcome:?}"
    );
    if let Some(pid) = read_pid(&pid_file) {
        assert!(
            eventually(|| !pid_is_alive(pid)).await,
            "the timeout must kill the child"
        );
    }
    assert!(
        eventually(|| scratch_roots(&home).is_empty()).await,
        "the timeout must remove the scratch root"
    );
    assert!(
        !error_file.exists(),
        "the child must never have seen its scratch vanish while alive: {:?}",
        std::fs::read_to_string(&error_file).unwrap_or_default()
    );
}
