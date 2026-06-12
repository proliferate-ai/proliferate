use std::path::Path;
use std::process::Command;

use super::artifacts::managed_npm_executable_relpath;
use super::paths::artifact_root;
use crate::domains::agents::installer::seed;
use crate::domains::agents::model::*;
use crate::integrations::agent_cli::executable::find_in_path;

pub(super) fn detect_runtime_compatibility_issue(
    descriptor: &AgentDescriptor,
    agent_process: &ResolvedArtifact,
    spawn: Option<&SpawnSpec>,
    runtime_home: &Path,
) -> Option<String> {
    if !agent_process.installed {
        return None;
    }

    if descriptor.kind != AgentKind::Claude {
        return None;
    }

    if !claude_launch_requires_node(descriptor, spawn) {
        return None;
    }

    let node_path = seed::bundled_node_bin(runtime_home)
        .or_else(|| find_in_path("node"))
        .or_else(|| find_in_path("node.exe"));
    let Some(node_path) = node_path else {
        return Some(
            "Claude ACP requires Node.js 20.10+, but neither bundled Node nor `node` on PATH was found. Upgrade the sandbox template or install a newer Node runtime."
                .into(),
        );
    };

    let output = Command::new(&node_path).arg("--version").output();
    let output = match output {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Some(format!(
                "Claude ACP requires Node.js 20.10+, but `{} --version` failed{}.",
                node_path.display(),
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                }
            ));
        }
        Err(error) => {
            return Some(format!(
                "Claude ACP requires Node.js 20.10+, but `{} --version` could not run: {error}.",
                node_path.display()
            ));
        }
    };

    let raw_version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let Some(version) = parse_node_version(&raw_version) else {
        return Some(format!(
            "Claude ACP requires Node.js 20.10+, but the runtime reported an unrecognized Node version `{raw_version}`."
        ));
    };

    let min_version = NodeVersion {
        major: 20,
        minor: 10,
        patch: 0,
    };
    if version >= min_version {
        return None;
    }

    let launch_target = spawn
        .map(|spec| spec.program.display().to_string())
        .unwrap_or_else(|| {
            artifact_root(runtime_home, &descriptor.kind, &ArtifactRole::AgentProcess)
                .join("claude-launcher")
                .display()
                .to_string()
        });
    Some(format!(
        "Claude ACP requires Node.js 20.10+, but found Node.js {raw_version}. The launch target `{launch_target}` will crash before ACP initialize. Upgrade the sandbox template image or install a newer Node runtime."
    ))
}

pub(super) fn claude_launch_requires_node(
    descriptor: &AgentDescriptor,
    spawn: Option<&SpawnSpec>,
) -> bool {
    if descriptor.kind != AgentKind::Claude {
        return false;
    }

    if let Some(spawn) = spawn {
        return spawn
            .program
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, "node" | "node.exe"));
    }

    managed_npm_executable_relpath(&descriptor.agent_process.install).is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct NodeVersion {
    pub(super) major: u32,
    pub(super) minor: u32,
    pub(super) patch: u32,
}

pub(super) fn parse_node_version(raw: &str) -> Option<NodeVersion> {
    let mut parts = raw.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some(NodeVersion {
        major,
        minor,
        patch,
    })
}
