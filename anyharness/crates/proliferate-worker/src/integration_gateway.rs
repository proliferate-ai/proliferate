use std::path::PathBuf;

use serde::Serialize;

use crate::{cloud_client::IntegrationGatewayConfig, config::WorkerConfig, error::WorkerError};

const DOTFILE_NAME: &str = "integration-gateway.json";
const DOTFILE_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
struct IntegrationGatewayDotfile<'a> {
    version: u32,
    url: &'a str,
    authorization: &'a str,
}

/// Absolute path of the integration-gateway dotfile: `integration_gateway_home`
/// from config when set, otherwise the derived runtime home.
pub fn dotfile_path(config: &WorkerConfig) -> PathBuf {
    let home = config
        .integration_gateway_home
        .clone()
        .unwrap_or_else(crate::config::default_integration_gateway_home);
    home.join(DOTFILE_NAME)
}

/// Atomically (re)write the integration-gateway dotfile from the enroll
/// response. Directory is created at 0700, file at 0600.
pub fn write(config: &WorkerConfig, gateway: &IntegrationGatewayConfig) -> Result<(), WorkerError> {
    let path = dotfile_path(config);
    let dotfile = IntegrationGatewayDotfile {
        version: DOTFILE_VERSION,
        url: &gateway.url,
        authorization: &gateway.authorization,
    };
    let contents = serde_json::to_vec_pretty(&dotfile)?;
    crate::config::write_private_file(&path, &contents, DOTFILE_NAME, |path, source| {
        WorkerError::WriteIntegrationGateway { path, source }
    })
}
