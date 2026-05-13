use tracing_subscriber::EnvFilter;

use crate::config::LoggingConfig;
use crate::error::Result;

pub fn init(config: &LoggingConfig) -> Result<()> {
    let filter = EnvFilter::try_from_env("PROLIFERATE_WORKER_LOG")
        .or_else(|_| EnvFilter::try_new(&config.level))
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init()
        .map_err(|error| crate::error::WorkerError::Config(error.to_string()))?;

    Ok(())
}
