use std::time::Duration;

use super::{
    build_spawn_command, find_anyharness_binary, persist_runtime_info, runtime_url_port,
    BootOutcome, RuntimeStatus, SharedSidecar, HEALTH_POLL_INTERVAL, HEALTH_POLL_TIMEOUT,
};

pub(super) async fn boot_inner(sidecar: &SharedSidecar) -> BootOutcome {
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

    let mut command = build_spawn_command(&binary, port, &launch_env);
    let mut guard = sidecar.lock().await;
    if guard.terminal_shutdown_armed {
        return BootOutcome::Rejected;
    }
    guard.info.status = RuntimeStatus::Starting;
    persist_runtime_info(&guard.info, None);
    let child_result = command.spawn();

    match child_result {
        Ok(child) => {
            tracing::info!("AnyHarness sidecar spawned; waiting for health");
            guard.child = Some(child);
            guard.info.status = RuntimeStatus::Starting;
            persist_runtime_info(&guard.info, None);
            drop(guard);
            wait_healthy(sidecar, true).await
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
