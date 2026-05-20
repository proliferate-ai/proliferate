use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use super::*;
use crate::live::sessions::connection::stderr::spawn_agent_stderr_logger;
use crate::observability::latency::{latency_trace_fields, LatencyRequestContext};

pub(in crate::live::sessions) struct SpawnedAgentProcess {
    pub child: tokio::process::Child,
    pub stdin: tokio::process::ChildStdin,
    pub stdout: tokio::process::ChildStdout,
}

pub(in crate::live::sessions) fn merge_spawn_env(
    workspace_env: &BTreeMap<String, String>,
    session_launch_env: &BTreeMap<String, String>,
    agent_auth_env: &BTreeMap<String, String>,
    override_env: Option<&HashMap<String, String>>,
    protected_agent_auth_env: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut merged = workspace_env.clone();
    for (key, value) in session_launch_env {
        merged.insert(key.clone(), value.clone());
    }
    for (key, value) in agent_auth_env {
        merged.insert(key.clone(), value.clone());
    }
    if let Some(override_env) = override_env {
        for (key, value) in override_env {
            merged.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in protected_agent_auth_env {
        merged.insert(key.clone(), value.clone());
    }
    merged
}

pub(in crate::live::sessions) fn spawn_agent_process(
    agent: &ResolvedAgent,
    workspace_path: &Path,
    workspace_env: &BTreeMap<String, String>,
    session_launch_env: &BTreeMap<String, String>,
    agent_auth_env: &BTreeMap<String, String>,
    protected_agent_auth_env: &BTreeMap<String, String>,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    latency: Option<&LatencyRequestContext>,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
) -> anyhow::Result<SpawnedAgentProcess> {
    let resolved_path = agent
        .agent_process
        .path
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no executable path for agent"))?;

    let spawn_spec = agent.spawn.as_ref();
    let spawn_program = spawn_spec
        .map(|spec| spec.program.as_path())
        .unwrap_or(resolved_path);
    let spawn_args = spawn_spec
        .map(|spec| spec.args.as_slice())
        .unwrap_or(agent.descriptor.launch.default_args.as_slice());
    let spawn_cwd = spawn_spec
        .and_then(|spec| spec.cwd.as_ref())
        .map_or(workspace_path, |path| path.as_path());
    let spawn_env = merge_spawn_env(
        workspace_env,
        session_launch_env,
        agent_auth_env,
        spawn_spec.map(|spec| &spec.env),
        protected_agent_auth_env,
    );
    let latency_fields = latency_trace_fields(latency);

    let process_spawn_started = std::time::Instant::now();
    let mut child = tokio::process::Command::new(spawn_program)
        .args(spawn_args)
        .envs(&spawn_env)
        .current_dir(spawn_cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                agent_kind = %source_agent_kind,
                elapsed_ms = process_spawn_started.elapsed().as_millis(),
                error = %e,
                flow_id = latency_fields.flow_id,
                flow_kind = latency_fields.flow_kind,
                flow_source = latency_fields.flow_source,
                prompt_id = latency_fields.prompt_id,
                "[workspace-latency] session.actor.process_spawn_failed"
            );
            let _ = ready_tx.send(Err(anyhow::anyhow!("spawn failed: {e}")));
            anyhow::anyhow!("spawn agent subprocess: {e}")
        })?;
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        agent_kind = %source_agent_kind,
        elapsed_ms = process_spawn_started.elapsed().as_millis(),
        flow_id = latency_fields.flow_id,
        flow_kind = latency_fields.flow_kind,
        flow_source = latency_fields.flow_source,
        prompt_id = latency_fields.prompt_id,
        "[workspace-latency] session.actor.process_spawned"
    );

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdout"))?;
    if let Some(stderr) = child.stderr.take() {
        spawn_agent_stderr_logger(stderr, session_id.to_owned(), source_agent_kind.to_owned());
    }

    Ok(SpawnedAgentProcess {
        child,
        stdin,
        stdout,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_spawn_env_prefers_session_launch_over_workspace_env() {
        let workspace_env = BTreeMap::from([
            (
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/workspace/bin/claude".to_string(),
            ),
            ("PATH".to_string(), "/usr/bin".to_string()),
        ]);
        let session_launch_env = BTreeMap::from([(
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            "/managed/bin/claude".to_string(),
        )]);

        let merged = merge_spawn_env(
            &workspace_env,
            &session_launch_env,
            &BTreeMap::new(),
            None,
            &BTreeMap::new(),
        );

        assert_eq!(
            merged.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
            Some("/managed/bin/claude")
        );
        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
    }

    #[test]
    fn merge_spawn_env_prefers_explicit_override_env_over_session_env() {
        let workspace_env = BTreeMap::from([("PATH".to_string(), "/usr/bin".to_string())]);
        let session_launch_env = BTreeMap::from([("DEBUG".to_string(), "0".to_string())]);
        let override_env = std::collections::HashMap::from([
            ("DEBUG".to_string(), "1".to_string()),
            ("FOO".to_string(), "bar".to_string()),
        ]);

        let merged = merge_spawn_env(
            &workspace_env,
            &session_launch_env,
            &BTreeMap::new(),
            Some(&override_env),
            &BTreeMap::new(),
        );

        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
        assert_eq!(merged.get("DEBUG").map(String::as_str), Some("1"));
        assert_eq!(merged.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn merge_spawn_env_applies_protected_agent_auth_last() {
        let workspace_env = BTreeMap::from([(
            "ANTHROPIC_BASE_URL".to_string(),
            "https://workspace.example".to_string(),
        )]);
        let session_launch_env = BTreeMap::from([(
            "ANTHROPIC_BASE_URL".to_string(),
            "https://session.example".to_string(),
        )]);
        let agent_auth_env = BTreeMap::from([("SUPPORT_FLAG".to_string(), "1".to_string())]);
        let override_env = std::collections::HashMap::from([(
            "ANTHROPIC_BASE_URL".to_string(),
            "https://override.example".to_string(),
        )]);
        let protected_agent_auth_env = BTreeMap::from([(
            "ANTHROPIC_BASE_URL".to_string(),
            "https://gateway.example".to_string(),
        )]);

        let merged = merge_spawn_env(
            &workspace_env,
            &session_launch_env,
            &agent_auth_env,
            Some(&override_env),
            &protected_agent_auth_env,
        );

        assert_eq!(
            merged.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://gateway.example")
        );
        assert_eq!(merged.get("SUPPORT_FLAG").map(String::as_str), Some("1"));
    }
}
