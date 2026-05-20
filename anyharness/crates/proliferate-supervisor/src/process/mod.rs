pub mod child;
pub mod health;
pub mod restart;

use tokio::time::{sleep, Duration};
use tracing::{info, warn};

use crate::{config::SupervisorConfig, error::SupervisorError};

pub async fn run(config: SupervisorConfig) -> Result<(), SupervisorError> {
    loop {
        let anyharness_env = config
            .anyharness_env
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()));
        let mut anyharness = match child::spawn_with_env(
            config.anyharness_binary.to_string_lossy().as_ref(),
            &config.anyharness_args,
            anyharness_env,
        ) {
            Ok(child) => child,
            Err(error) => {
                warn!(?error, "failed to start anyharness");
                sleep(restart::backoff(config.restart_delay_seconds)).await;
                continue;
            }
        };
        info!("anyharness started");
        loop {
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
            let mut worker = match child::spawn_with_env(
                config.worker_binary.to_string_lossy().as_ref(),
                &worker_args,
                worker_env,
            ) {
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
        if health::is_upgrade_window() {
            sleep(restart::backoff(config.restart_delay_seconds)).await;
        } else {
            sleep(Duration::from_secs(config.restart_delay_seconds.max(1))).await;
        }
    }
}
