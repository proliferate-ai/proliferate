use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, DesiredVersions},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    observability,
};

use super::{status, supervisor};

#[derive(Debug, Clone)]
pub struct InstalledVersions {
    pub anyharness_version: Option<String>,
    pub worker_version: Option<String>,
    pub supervisor_version: Option<String>,
}

pub async fn reconcile(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    desired: &DesiredVersions,
    installed: &InstalledVersions,
) -> Result<(), WorkerError> {
    if !desired.should_update {
        clear_stale_request(config)?;
        return Ok(());
    }
    let stale = stale_desired_versions(desired, installed);
    if !stale.should_update {
        clear_stale_request(config)?;
        return Ok(());
    }
    observability::update_requested(&stale);
    match supervisor::stage_update_request(config, &stale) {
        Ok(staged) => {
            info!(
                component = staged.component.as_deref(),
                version = staged.version.as_deref(),
                path = %staged.path.display(),
                wrote_request = staged.wrote_request,
                "supervisor update request staged"
            );
            Ok(())
        }
        Err(error) => {
            warn!(?error, "failed to stage supervisor update request");
            let _ = cloud
                .report_update_status(
                    &identity.worker_token,
                    &status::failed(stale.update_generation, error.to_string()),
                )
                .await;
            Err(error)
        }
    }
}

fn clear_stale_request(config: &WorkerConfig) -> Result<(), WorkerError> {
    if supervisor::clear_update_request(config)? {
        info!("cleared stale supervisor update request");
    }
    Ok(())
}

fn stale_desired_versions(
    desired: &DesiredVersions,
    installed: &InstalledVersions,
) -> DesiredVersions {
    let anyharness_version =
        stale_version(&desired.anyharness_version, &installed.anyharness_version);
    let worker_version = stale_version(&desired.worker_version, &installed.worker_version);
    let supervisor_version =
        stale_version(&desired.supervisor_version, &installed.supervisor_version);
    DesiredVersions {
        should_update: anyharness_version.is_some()
            || worker_version.is_some()
            || supervisor_version.is_some(),
        update_channel: desired.update_channel.clone(),
        update_generation: desired.update_generation,
        anyharness_version,
        worker_version,
        supervisor_version,
    }
}

fn stale_version(desired: &Option<String>, installed: &Option<String>) -> Option<String> {
    let desired = desired.as_ref()?;
    if installed.as_deref() == Some(desired.as_str()) {
        return None;
    }
    Some(desired.clone())
}

#[cfg(test)]
mod tests {
    use crate::cloud_client::DesiredVersions;

    use super::{stale_desired_versions, InstalledVersions};

    #[test]
    fn stale_desired_versions_keeps_only_components_that_need_updates() {
        let desired = DesiredVersions {
            should_update: true,
            update_channel: "stable".to_string(),
            update_generation: 4,
            anyharness_version: Some("0.2.0".to_string()),
            worker_version: Some("0.2.0".to_string()),
            supervisor_version: Some("0.2.0".to_string()),
        };
        let installed = InstalledVersions {
            anyharness_version: Some("0.2.0".to_string()),
            worker_version: Some("0.1.0".to_string()),
            supervisor_version: Some("0.2.0".to_string()),
        };
        let stale = stale_desired_versions(&desired, &installed);
        assert!(stale.should_update);
        assert_eq!(stale.update_generation, 4);
        assert_eq!(stale.anyharness_version, None);
        assert_eq!(stale.worker_version.as_deref(), Some("0.2.0"));
        assert_eq!(stale.supervisor_version, None);
    }

    #[test]
    fn stale_desired_versions_treats_unknown_installed_version_as_stale() {
        let desired = DesiredVersions {
            should_update: true,
            update_channel: "stable".to_string(),
            update_generation: 5,
            anyharness_version: None,
            worker_version: Some("0.2.0".to_string()),
            supervisor_version: None,
        };
        let installed = InstalledVersions {
            anyharness_version: None,
            worker_version: None,
            supervisor_version: None,
        };
        let stale = stale_desired_versions(&desired, &installed);
        assert!(stale.should_update);
        assert_eq!(stale.worker_version.as_deref(), Some("0.2.0"));
    }
}
