pub mod child;
pub mod health;
pub mod restart;

use std::time::Duration;

use proliferate_runtime_update_protocol::UpdateRequestV1;
use tokio::{process::Child, time::sleep};
use tracing::{info, warn};

use crate::{
    config::SupervisorConfig,
    error::SupervisorError,
    update::{self, activate::ActivationHost},
};

pub async fn run(config: SupervisorConfig) -> Result<(), SupervisorError> {
    loop {
        let mut anyharness = match spawn_anyharness(&config) {
            Ok(child) => child,
            Err(error) => {
                warn!(?error, "failed to start anyharness");
                sleep(restart::backoff(config.restart_delay_seconds)).await;
                continue;
            }
        };
        info!("anyharness started");
        loop {
            let mut worker = match spawn_worker(&config) {
                Ok(child) => child,
                Err(error) => {
                    warn!(?error, "failed to start proliferate-worker");
                    tokio::select! {
                        result = anyharness.wait() => {
                            warn!(?result, "anyharness exited while worker spawn was failing");
                            break;
                        }
                        _ = sleep(restart::backoff(config.restart_delay_seconds)) => {}
                    }
                    continue;
                }
            };
            info!("proliferate-worker started");

            // Drain the update mailbox once both children are up and before the
            // restart select, so an update in flight cannot race an unrelated
            // child-exit restart. The drain is idempotent: an already-actioned
            // request has a result and is skipped.
            {
                let mut host = LiveHost {
                    config: &config,
                    anyharness: &mut anyharness,
                    worker: &mut worker,
                };
                if let Err(error) = update::activate::run_pending(&config, &mut host).await {
                    warn!(?error, "update mailbox drain failed");
                }
            }

            tokio::select! {
                result = anyharness.wait() => {
                    warn!(?result, "anyharness exited");
                    let _ = worker.kill().await;
                    let _ = worker.wait().await;
                    break;
                }
                result = worker.wait() => {
                    warn!(?result, "proliferate-worker exited");
                    sleep(restart::backoff(config.restart_delay_seconds)).await;
                }
            }
        }
        sleep(restart::backoff(config.restart_delay_seconds)).await;
    }
}

fn spawn_anyharness(config: &SupervisorConfig) -> Result<Child, SupervisorError> {
    let anyharness_env = config
        .anyharness_env
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()));
    child::spawn_with_env(
        config.anyharness_binary.to_string_lossy().as_ref(),
        &config.anyharness_args,
        anyharness_env,
    )
}

fn spawn_worker(config: &SupervisorConfig) -> Result<Child, SupervisorError> {
    let worker_args = [
        "--config".to_string(),
        config.worker_config.to_string_lossy().to_string(),
    ];
    let supervisor_version = env!("CARGO_PKG_VERSION");
    let mut worker_env = vec![("PROLIFERATE_SUPERVISOR_VERSION", supervisor_version)];
    worker_env.extend(
        config
            .process_env
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str())),
    );
    child::spawn_with_env(
        config.worker_binary.to_string_lossy().as_ref(),
        &worker_args,
        worker_env,
    )
}

/// Production adapter for the activation state machine: it owns the live child
/// handles the machine restarts, wires the bounded artifact fetch, and runs the
/// real health gate. Keeping this here (not in `update/activate.rs`) is what
/// lets the state machine stay free of process/network concerns and be unit
/// tested with fake seams.
struct LiveHost<'a> {
    config: &'a SupervisorConfig,
    anyharness: &'a mut Child,
    worker: &'a mut Child,
}

impl ActivationHost for LiveHost<'_> {
    async fn fetch_artifact(
        &mut self,
        request: &UpdateRequestV1,
    ) -> Result<Vec<u8>, SupervisorError> {
        update::download::download_artifact(
            request,
            self.config.max_artifact_bytes,
            self.config.download_timeout_seconds,
        )
        .await
    }

    async fn restart_anyharness(&mut self) -> Result<(), SupervisorError> {
        let _ = self.anyharness.kill().await;
        let _ = self.anyharness.wait().await;
        *self.anyharness = spawn_anyharness(self.config)?;
        Ok(())
    }

    async fn restart_worker(&mut self) -> Result<(), SupervisorError> {
        let _ = self.worker.kill().await;
        let _ = self.worker.wait().await;
        *self.worker = spawn_worker(self.config)?;
        Ok(())
    }

    async fn anyharness_healthy(&mut self) -> bool {
        health::anyharness_healthy(
            &self.config.anyharness_health_url,
            None,
            self.config.health_check_attempts,
            Duration::from_secs(self.config.health_check_delay_seconds),
        )
        .await
    }

    async fn worker_alive(&mut self) -> bool {
        health::worker_alive(self.worker)
    }
}
