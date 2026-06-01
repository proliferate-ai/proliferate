use std::path::Path;

use super::downloads::{curl_download_binary, curl_fetch_text, download_and_extract_tarball};
use super::{InstallError, InstallOptions, InstalledArtifactResult};
use crate::domains::agents::model::*;
use crate::domains::agents::readiness::resolver::artifact_root;
use crate::integrations::agent_cli::executable::{
    find_in_path, is_valid_executable, make_executable,
};

pub(super) fn is_native_installable(spec: &NativeInstallSpec) -> bool {
    matches!(
        spec,
        NativeInstallSpec::DirectBinary { .. } | NativeInstallSpec::TarballRelease { .. }
    )
}

pub(super) fn install_native_artifact(
    spec: &NativeArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
    options: &InstallOptions,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::NativeCli);
    let target_path = managed_dir.join(kind.as_str());

    if is_valid_executable(&target_path) && !options.reinstall {
        return Ok(None);
    }

    if !options.reinstall {
        if let Some(path_binary) =
            find_in_path(kind.as_str()).filter(|path| is_valid_executable(path))
        {
            tracing::info!(
                agent = kind.as_str(),
                path = %path_binary.display(),
                "skipping managed native install because native CLI is already available on PATH"
            );
            return Ok(None);
        }
    }

    std::fs::create_dir_all(&managed_dir)?;
    let temp_path = managed_dir.join(format!(".{}.downloading", kind.as_str()));

    match &spec.install {
        NativeInstallSpec::DirectBinary {
            binary_url_template,
            platform_map,
            latest_version_url,
        } => {
            let platform = Platform::detect().ok_or(InstallError::UnsupportedPlatform)?;
            let platform_str = platform_map
                .iter()
                .find(|(p, _)| *p == platform)
                .map(|(_, s)| s.as_str())
                .ok_or(InstallError::UnsupportedPlatform)?;

            let version = options.native_version.clone().unwrap_or_else(|| {
                latest_version_url
                    .as_ref()
                    .and_then(|url| curl_fetch_text(url).ok())
                    .unwrap_or_else(|| "latest".into())
                    .trim()
                    .to_string()
            });

            let url = binary_url_template
                .replace("{version}", &version)
                .replace("{platform}", platform_str);

            let result = curl_download_binary(&url, &temp_path);
            if result.is_err() {
                let _ = std::fs::remove_file(&temp_path);
                return Err(result.unwrap_err());
            }
            make_executable(&temp_path)?;
            std::fs::rename(&temp_path, &target_path)?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::NativeCli,
                path: target_path,
                source: "managed_download".into(),
                version: Some(version),
            }))
        }
        NativeInstallSpec::TarballRelease {
            latest_url_template,
            versioned_url_template,
            expected_binary_template,
            platform_map,
        } => {
            let platform = Platform::detect().ok_or(InstallError::UnsupportedPlatform)?;
            let target_triple = platform_map
                .iter()
                .find(|(p, _)| *p == platform)
                .map(|(_, s)| s.as_str())
                .ok_or(InstallError::UnsupportedPlatform)?;

            let url = match &options.native_version {
                Some(v) => versioned_url_template
                    .replace("{version}", v)
                    .replace("{target}", target_triple),
                None => latest_url_template.replace("{target}", target_triple),
            };
            let expected_binary = expected_binary_template.replace("{target}", target_triple);

            download_and_extract_tarball(&url, &expected_binary, &managed_dir, &temp_path)?;
            make_executable(&temp_path)?;
            std::fs::rename(&temp_path, &target_path)?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::NativeCli,
                path: target_path,
                source: "managed_release".into(),
                version: options.native_version.clone(),
            }))
        }
        NativeInstallSpec::PathOnly { .. } | NativeInstallSpec::Manual { .. } => Ok(None),
    }
}
