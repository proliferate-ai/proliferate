use std::path::{Path, PathBuf};

pub(super) fn apply_npm_version_override(package: &str, version_override: Option<&str>) -> String {
    if let Some(version) = version_override {
        if is_npm_non_registry_spec(package) {
            let base = package
                .split_once('#')
                .map_or(package, |(specifier, _)| specifier);
            return format!("{base}#{version}");
        }
    }

    match version_override {
        Some(version) => format!("{}@{version}", strip_npm_version(package)),
        None => package.to_string(),
    }
}

fn strip_npm_version(package: &str) -> &str {
    if let Some(scoped_package) = package.strip_prefix('@') {
        if let Some(version_separator) = scoped_package.rfind('@') {
            return &package[..version_separator + 1];
        }
        return package;
    }

    package.split_once('@').map_or(package, |(name, _)| name)
}

pub(super) fn npm_package_version(package: &str) -> Option<String> {
    if is_npm_non_registry_spec(package) {
        return package
            .split_once('#')
            .map(|(_, version_or_ref)| version_or_ref.to_string());
    }

    if let Some(scoped_package) = package.strip_prefix('@') {
        return scoped_package
            .rsplit_once('@')
            .map(|(_, version)| version.to_string());
    }

    package
        .split_once('@')
        .map(|(_, version)| version.to_string())
}

pub(super) fn installed_npm_package_version(package: &str, managed_dir: &Path) -> Option<String> {
    let package_name = npm_package_name(package)?;
    let package_json = managed_dir
        .join("node_modules")
        .join(PathBuf::from(package_name))
        .join("package.json");
    let text = std::fs::read_to_string(package_json).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("version")?.as_str().map(ToString::to_string)
}

pub(super) fn npm_package_name(package: &str) -> Option<&str> {
    if is_npm_non_registry_spec(package) {
        return None;
    }

    let package = package.split_once('#').map_or(package, |(name, _)| name);
    if package.starts_with('@') {
        let mut at_positions = package.match_indices('@').map(|(index, _)| index);
        at_positions.next();
        return at_positions.next().map_or(Some(package), |index| {
            let candidate = &package[..index];
            if candidate.contains('/') {
                Some(candidate)
            } else {
                Some(package)
            }
        });
    }

    Some(package.split_once('@').map_or(package, |(name, _)| name))
}

pub(super) fn is_npm_non_registry_spec(package: &str) -> bool {
    package.starts_with("git+")
        || package.starts_with("github:")
        || package.starts_with("file:")
        || package.starts_with("http://")
        || package.starts_with("https://")
}

/// Records the exact source spec a managed npm artifact was installed from.
/// Subdir installs go through `npm pack`, so the managed prefix's own npm
/// metadata only references a temporary tarball and cannot answer "which git
/// ref is this?" — the marker file is the source of truth for those.
pub(super) const MANAGED_NPM_SOURCE_MARKER: &str = ".anyharness-npm-source";

pub(super) fn write_managed_npm_source_marker(
    package: &str,
    managed_dir: &Path,
) -> std::io::Result<()> {
    std::fs::write(managed_dir.join(MANAGED_NPM_SOURCE_MARKER), package)
}

fn recorded_source_spec(managed_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(managed_dir.join(MANAGED_NPM_SOURCE_MARKER)).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn managed_npm_install_issue(package: &str, managed_dir: &Path) -> Option<String> {
    if is_npm_non_registry_spec(package) {
        if non_registry_install_matches(package, managed_dir) {
            return None;
        }
        return Some("Managed agent package is out of date. Reinstall this agent to update the bundled ACP adapter.".into());
    }

    let Some(expected_version) = npm_package_version(package) else {
        return None;
    };
    if !is_pinned_registry_version(&expected_version) {
        return None;
    }

    match installed_npm_package_version(package, managed_dir) {
        Some(installed_version) if installed_version == expected_version => None,
        Some(installed_version) => Some(format!(
            "Managed agent package is out of date. Expected version {expected_version}, found {installed_version}. Reinstall this agent to update the bundled ACP adapter."
        )),
        None => Some(
            "Managed agent package metadata is missing. Reinstall this agent to update the bundled ACP adapter."
                .into(),
        ),
    }
}

fn non_registry_install_matches(package: &str, managed_dir: &Path) -> bool {
    let normalized_package = normalize_npm_spec(package);
    if recorded_source_spec(managed_dir).is_some_and(|recorded| {
        recorded == package
            || normalize_npm_spec(&recorded)
                .zip(normalized_package.as_ref())
                .is_some_and(|(left, right)| left == *right)
    }) {
        return true;
    }

    let dependency_specs = root_dependency_specs(managed_dir);
    if dependency_specs.iter().any(|spec| {
        spec == package
            || normalize_npm_spec(spec)
                .zip(normalized_package.as_ref())
                .is_some_and(|(left, right)| left == *right)
    }) {
        return true;
    }

    let Some(expected_ref) = package.split_once('#').map(|(_, value)| value) else {
        return false;
    };
    if expected_ref.trim().is_empty() {
        return false;
    }

    dependency_specs
        .iter()
        .any(|spec| spec.ends_with(&format!("#{expected_ref}")))
        || std::fs::read_to_string(managed_dir.join("package-lock.json"))
            .ok()
            .is_some_and(|lock| lock.contains(&format!("#{expected_ref}\"")))
}

fn root_dependency_specs(managed_dir: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(managed_dir.join("package.json")) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };

    ["dependencies", "devDependencies", "optionalDependencies"]
        .into_iter()
        .filter_map(|key| json.get(key)?.as_object())
        .flat_map(|deps| deps.values())
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect()
}

fn normalize_npm_spec(spec: &str) -> Option<String> {
    let mut normalized = spec.strip_prefix("git+").unwrap_or(spec).to_string();
    let without_scheme = normalized
        .strip_prefix("git://")
        .or_else(|| normalized.strip_prefix("https://"))
        .or_else(|| normalized.strip_prefix("github:"))
        .unwrap_or(normalized.as_str())
        .to_string();
    normalized = without_scheme;
    normalized = normalized
        .replace("git@github.com:", "github.com/")
        .replace("ssh://git@github.com/", "github.com/")
        .replace("https://github.com/", "github.com/");
    if let Some((prefix, suffix)) = normalized.split_once('#') {
        normalized = format!("{}#{suffix}", prefix.strip_suffix(".git").unwrap_or(prefix));
    } else if let Some(stripped) = normalized.strip_suffix(".git") {
        normalized = stripped.to_string();
    }

    if normalized == spec {
        None
    } else {
        Some(normalized)
    }
}

fn is_pinned_registry_version(version: &str) -> bool {
    version
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn detects_changed_git_ref_from_root_dependency_metadata() {
        let managed_dir = temp_dir("managed-npm-git-ref");
        std::fs::write(
            managed_dir.join("package.json"),
            r#"{"dependencies":{"@agentclientprotocol/claude-agent-acp":"github:proliferate-ai/claude-agent-acp#old-ref"}}"#,
        )
        .expect("write package metadata");

        let issue = managed_npm_install_issue(
            "git+https://github.com/proliferate-ai/claude-agent-acp.git#new-ref",
            &managed_dir,
        );

        assert!(issue.is_some());
        let _ = std::fs::remove_dir_all(managed_dir);
    }

    #[test]
    fn accepts_matching_git_ref_from_root_dependency_metadata() {
        let managed_dir = temp_dir("managed-npm-git-ref-match");
        std::fs::write(
            managed_dir.join("package.json"),
            r#"{"dependencies":{"@agentclientprotocol/claude-agent-acp":"github:proliferate-ai/claude-agent-acp#new-ref"}}"#,
        )
        .expect("write package metadata");

        let issue = managed_npm_install_issue(
            "git+https://github.com/proliferate-ai/claude-agent-acp.git#new-ref",
            &managed_dir,
        );

        assert!(issue.is_none());
        let _ = std::fs::remove_dir_all(managed_dir);
    }

    #[test]
    fn accepts_subdir_install_with_matching_source_marker() {
        let managed_dir = temp_dir("managed-npm-source-marker-match");
        std::fs::write(
            managed_dir.join("package.json"),
            r#"{"dependencies":{"@proliferate-ai/codex-acp":"file:../../tmp/anyharness-npm-subdir-abc/proliferate-ai-codex-acp-0.16.0.tgz"}}"#,
        )
        .expect("write package metadata");
        write_managed_npm_source_marker(
            "git+https://github.com/proliferate-ai/codex-acp.git#new-ref",
            &managed_dir,
        )
        .expect("write source marker");

        let issue = managed_npm_install_issue(
            "git+https://github.com/proliferate-ai/codex-acp.git#new-ref",
            &managed_dir,
        );

        assert!(issue.is_none());
        let _ = std::fs::remove_dir_all(managed_dir);
    }

    #[test]
    fn detects_changed_git_ref_against_source_marker() {
        let managed_dir = temp_dir("managed-npm-source-marker-stale");
        std::fs::write(
            managed_dir.join("package.json"),
            r#"{"dependencies":{"@proliferate-ai/codex-acp":"file:../../tmp/anyharness-npm-subdir-abc/proliferate-ai-codex-acp-0.15.0.tgz"}}"#,
        )
        .expect("write package metadata");
        write_managed_npm_source_marker(
            "git+https://github.com/proliferate-ai/codex-acp.git#old-ref",
            &managed_dir,
        )
        .expect("write source marker");

        let issue = managed_npm_install_issue(
            "git+https://github.com/proliferate-ai/codex-acp.git#new-ref",
            &managed_dir,
        );

        assert!(issue.is_some());
        let _ = std::fs::remove_dir_all(managed_dir);
    }

    #[test]
    fn detects_registry_version_mismatch() {
        let managed_dir = temp_dir("managed-npm-registry-version");
        let package_dir = managed_dir
            .join("node_modules")
            .join("@proliferateai")
            .join("codex-acp");
        std::fs::create_dir_all(&package_dir).expect("create package dir");
        std::fs::write(package_dir.join("package.json"), r#"{"version":"0.11.6"}"#)
            .expect("write installed package metadata");

        let issue = managed_npm_install_issue("@proliferateai/codex-acp@0.11.8", &managed_dir);

        assert!(issue.is_some());
        let _ = std::fs::remove_dir_all(managed_dir);
    }
}
