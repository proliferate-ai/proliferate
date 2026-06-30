use tracing::info;

use crate::{
    cloud_client::CloudClient, config::WorkerConfig, error::WorkerError,
    identity::credentials::WorkerIdentity, materialization::github_credentials,
};

const UNSUPPORTED_TARGET_CODE: &str = "cloud_worker_github_credentials_unsupported_target";

pub async fn converge_once(
    _config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    if github_credentials::lease_is_fresh()? {
        github_credentials::ensure_global_git_config()?;
        return Ok(());
    }
    let request = github_credentials::current_lease_request()?;
    let lease = match cloud
        .refresh_github_credentials(&identity.worker_token, &request)
        .await
    {
        Ok(lease) => lease,
        Err(WorkerError::Cloud { status, body })
            if status == reqwest::StatusCode::CONFLICT
                && body.contains(UNSUPPORTED_TARGET_CODE) =>
        {
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    github_credentials::write_lease(&lease)?;
    github_credentials::ensure_global_git_config()?;
    info!(
        provider = lease.provider,
        token_kind = lease.token_kind,
        actor_login = lease.actor_login.as_deref().unwrap_or(""),
        expires_at = %lease.expires_at,
        refresh_after = %lease.refresh_after,
        "github credential lease refreshed"
    );
    Ok(())
}
