use std::{fs, path::PathBuf};

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
    write_contents(config, &serialized_contents(gateway)?)
}

/// Restore the active Worker's gateway credential only when the shared file
/// differs. The runtime calls this after a successful authenticated heartbeat,
/// so a predecessor stops reasserting after heartbeat observes its revocation;
/// the active successor repairs a final write that raced that revocation.
pub fn ensure_current(
    config: &WorkerConfig,
    gateway: &IntegrationGatewayConfig,
) -> Result<bool, WorkerError> {
    let contents = serialized_contents(gateway)?;
    if fs::read(dotfile_path(config)).is_ok_and(|current| current == contents) {
        return Ok(false);
    }
    write_contents(config, &contents)?;
    Ok(true)
}

fn serialized_contents(gateway: &IntegrationGatewayConfig) -> Result<Vec<u8>, WorkerError> {
    let dotfile = IntegrationGatewayDotfile {
        version: DOTFILE_VERSION,
        url: &gateway.url,
        authorization: &gateway.authorization,
    };
    Ok(serde_json::to_vec_pretty(&dotfile)?)
}

fn write_contents(config: &WorkerConfig, contents: &[u8]) -> Result<(), WorkerError> {
    let path = dotfile_path(config);
    crate::config::write_private_file(&path, &contents, DOTFILE_NAME, |path, source| {
        WorkerError::WriteIntegrationGateway { path, source }
    })
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{dotfile_path, ensure_current, write};
    use crate::{cloud_client::IntegrationGatewayConfig, config::WorkerConfig};

    fn test_config() -> (WorkerConfig, std::path::PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-gateway-reassert-{}-{unique}",
            std::process::id()
        ));
        let mut config: WorkerConfig = toml::from_str(
            r#"
cloud_base_url = "https://cloud.test"
worker_db_path = "worker.sqlite3"
"#,
        )
        .expect("parse test Worker config");
        config.integration_gateway_home = Some(root.clone());
        (config, root)
    }

    #[test]
    fn active_gateway_reassert_repairs_a_delayed_predecessor_write() {
        let (config, root) = test_config();
        let current = IntegrationGatewayConfig {
            url: "https://cloud.test/v1/cloud/integration-gateway/mcp".to_string(),
            authorization: "Bearer current".to_string(),
        };
        let predecessor = IntegrationGatewayConfig {
            url: current.url.clone(),
            authorization: "Bearer revoked-predecessor".to_string(),
        };

        write(&config, &current).expect("write current gateway credential");
        write(&config, &predecessor).expect("simulate delayed predecessor overwrite");

        assert!(ensure_current(&config, &current).expect("repair active gateway credential"));
        let restored: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dotfile_path(&config)).expect("read restored gateway credential"),
        )
        .expect("parse restored gateway credential");
        assert_eq!(restored["authorization"], "Bearer current");
        assert!(!ensure_current(&config, &current).expect("leave current credential unchanged"));

        std::fs::remove_dir_all(root).expect("remove gateway test directory");
    }
}
