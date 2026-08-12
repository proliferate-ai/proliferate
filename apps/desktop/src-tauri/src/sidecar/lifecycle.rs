use std::sync::Arc;
use std::time::Duration;

use super::{
    diagnostics, find_anyharness_binary, observer, persist_runtime_info, runtime_health_url,
    runtime_url_port, BootOutcome, RuntimeHealthRecord, RuntimeStatus, SharedSidecar,
    HEALTH_POLL_INTERVAL, HEALTH_POLL_TIMEOUT,
};
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;

pub(super) async fn boot_inner(
    sidecar: &SharedSidecar,
    supervisor: &Arc<DiagnosticsCollectorSupervisor>,
) -> BootOutcome {
    if sidecar.lock().await.terminal_shutdown_armed {
        return BootOutcome::Rejected;
    }
    // Dev-URL mode: point at an externally running AnyHarness, skip spawn.
    if let Ok(dev_url) = std::env::var("ANYHARNESS_DEV_URL") {
        tracing::info!(
            runtime_url = %dev_url,
            "ANYHARNESS_DEV_URL set, using external runtime"
        );
        {
            let mut guard = sidecar.lock().await;
            if guard.terminal_shutdown_armed {
                return BootOutcome::Rejected;
            }
            guard.info.port = runtime_url_port(&dev_url).unwrap_or(guard.info.port);
            guard.info.url = dev_url;
            guard.info.status = RuntimeStatus::Starting;
            persist_runtime_info(&guard.info, None);
        }
        let _ = wait_healthy(sidecar, false).await;
        return BootOutcome::External;
    }

    let binary = match find_anyharness_binary() {
        Some(b) => b,
        None => {
            tracing::error!("No AnyHarness binary found and no dev URL set");
            let mut guard = sidecar.lock().await;
            guard.info.status = RuntimeStatus::Failed;
            persist_runtime_info(&guard.info, None);
            return BootOutcome::Failed("binary_missing");
        }
    };

    let (port, launch_env) = {
        let guard = sidecar.lock().await;
        if guard.terminal_shutdown_armed {
            return BootOutcome::Rejected;
        }
        (guard.info.port, guard.launch_env.clone())
    };

    tracing::info!(
        binary = %binary,
        port,
        "Launching AnyHarness sidecar"
    );

    let mut guard = sidecar.lock().await;
    if guard.terminal_shutdown_armed {
        return BootOutcome::Rejected;
    }
    guard.info.status = RuntimeStatus::Starting;
    persist_runtime_info(&guard.info, None);
    // The direct executable and full command are prepared before any
    // observability descriptor exists; the spawn itself may carry the
    // protected bridge/shutdown descriptors on supported targets.
    let spawn_result = diagnostics::spawn_owned_anyharness(&binary, port, &launch_env, supervisor);

    match spawn_result {
        Ok(spawned) => {
            tracing::info!("AnyHarness sidecar spawned; waiting for health");
            guard.child = Some(spawned.child);
            #[cfg(all(
                target_os = "macos",
                any(target_arch = "aarch64", target_arch = "x86_64")
            ))]
            {
                guard.diagnostics_bridge = spawned.bridge;
            }
            guard.info.status = RuntimeStatus::Starting;
            persist_runtime_info(&guard.info, None);
            drop(guard);
            let outcome = wait_healthy(sidecar, true).await;
            // A timeout, cancellation, or ambiguous `try_wait` can retain a
            // live identity-stable child just as success does. Install the
            // sole generation-fenced observer whenever ownership remains.
            observer::start(sidecar).await;
            outcome
        }
        Err(e) => {
            tracing::error!(
                binary = %binary,
                error = %e,
                "Failed to spawn AnyHarness sidecar"
            );
            guard.info.status = RuntimeStatus::Failed;
            persist_runtime_info(&guard.info, None);
            BootOutcome::Failed("spawn_failed")
        }
    }
}

pub(super) async fn wait_healthy(sidecar: &SharedSidecar, require_child: bool) -> BootOutcome {
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    loop {
        let url = {
            let mut guard = sidecar.lock().await;
            if guard.terminal_shutdown_armed {
                return BootOutcome::Cancelled;
            }
            if require_child {
                let Some(child) = guard.child.as_mut() else {
                    guard.info.status = RuntimeStatus::Stopped;
                    persist_runtime_info(&guard.info, None);
                    tracing::error!("AnyHarness sidecar handle missing during startup");
                    return BootOutcome::Failed("child_exited");
                };
                match child.try_wait() {
                    Ok(Some(status)) => {
                        guard.finish_diagnostics_reap(status).await;
                        guard.child = None;
                        guard.clear_diagnostics_bridge();
                        guard.info.status = RuntimeStatus::Failed;
                        persist_runtime_info(&guard.info, None);
                        tracing::error!(
                            exit_status = %status,
                            "AnyHarness sidecar exited before becoming healthy"
                        );
                        return BootOutcome::Failed("child_exited");
                    }
                    Ok(None) => {}
                    Err(error) => {
                        guard.info.status = RuntimeStatus::Failed;
                        persist_runtime_info(&guard.info, None);
                        tracing::error!(
                            error = %error,
                            "Failed to inspect AnyHarness sidecar process state"
                        );
                        return BootOutcome::Failed("child_inspection_failed");
                    }
                }
            }

            runtime_health_url(&guard.info.url)
        };

        if start.elapsed() > HEALTH_POLL_TIMEOUT {
            let mut guard = sidecar.lock().await;
            guard.info.status = RuntimeStatus::Failed;
            persist_runtime_info(&guard.info, None);
            tracing::error!(
                timeout_ms = HEALTH_POLL_TIMEOUT.as_millis(),
                "AnyHarness runtime failed to become healthy in time"
            );
            return BootOutcome::TimedOut;
        }

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let health = resp.json::<RuntimeHealthRecord>().await.ok();
                tracing::info!(health_url = %url, "AnyHarness runtime is healthy");
                let mut guard = sidecar.lock().await;
                guard.info.status = RuntimeStatus::Healthy;
                persist_runtime_info(&guard.info, health.as_ref());
                return BootOutcome::Succeeded;
            }
            _ => {}
        }

        tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
    }
}
