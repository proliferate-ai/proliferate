use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use super::*;
use crate::live::sessions::driver::stderr::{spawn_agent_stderr_logger, AgentStderrTail};
use crate::process_env::remove_runtime_private_env;

pub(in crate::live::sessions) struct SpawnedAgentProcess {
    pub child: tokio::process::Child,
    pub stdin: tokio::process::ChildStdin,
    pub stdout: tokio::process::ChildStdout,
    pub stderr_tail: AgentStderrTail,
    /// Completes when the stderr pipe reaches EOF (shortly after child exit).
    pub stderr_done: Option<tokio::task::JoinHandle<()>>,
}

pub(in crate::live::sessions) fn merge_spawn_env(
    workspace_env: &BTreeMap<String, String>,
    session_launch_env: &BTreeMap<String, String>,
    override_env: Option<&HashMap<String, String>>,
) -> BTreeMap<String, String> {
    let mut merged = workspace_env.clone();
    for (key, value) in session_launch_env {
        merged.insert(key.clone(), value.clone());
    }
    if let Some(override_env) = override_env {
        for (key, value) in override_env {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

pub(in crate::live::sessions) fn spawn_agent_process(
    agent: &ResolvedAgent,
    workspace_path: &Path,
    workspace_env: &BTreeMap<String, String>,
    session_launch_env: &BTreeMap<String, String>,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
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
    let (spawn_cwd, spawn_cwd_source) = spawn_spec
        .and_then(|spec| spec.cwd.as_ref())
        .map_or((workspace_path, "workspace"), |path| {
            (path.as_path(), "agent_override")
        });
    let spawn_env = merge_spawn_env(
        workspace_env,
        session_launch_env,
        spawn_spec.map(|spec| &spec.env),
    );
    if let Err(error) = validate_spawn_cwd(spawn_cwd, spawn_cwd_source) {
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            agent_kind = %source_agent_kind,
            spawn_program = %spawn_program.display(),
            agent_process_path = %resolved_path.display(),
            spawn_cwd = %spawn_cwd.display(),
            spawn_cwd_source,
            error = %error,
            "[workspace-latency] session.actor.process_spawn_cwd_invalid"
        );
        let _ = ready_tx.send(Err(anyhow::anyhow!(error.clone())));
        anyhow::bail!("spawn agent subprocess: {error}");
    }

    let process_spawn_started = std::time::Instant::now();
    let mut command = tokio::process::Command::new(spawn_program);
    command
        .args(spawn_args)
        .envs(&spawn_env)
        .current_dir(spawn_cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    remove_runtime_private_env(&mut command);
    let mut child = command.spawn().map_err(|e| {
        tracing::warn!(
            session_id = %session_id,
            workspace_id = %workspace_id,
            agent_kind = %source_agent_kind,
            spawn_program = %spawn_program.display(),
            agent_process_path = %resolved_path.display(),
            spawn_cwd = %spawn_cwd.display(),
            spawn_cwd_source,
            elapsed_ms = process_spawn_started.elapsed().as_millis(),
            error = %e,
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
    let (stderr_tail, stderr_done) = match child.stderr.take() {
        Some(stderr) => {
            let (tail, reader_task) = spawn_agent_stderr_logger(
                stderr,
                session_id.to_owned(),
                source_agent_kind.to_owned(),
            );
            (tail, Some(reader_task))
        }
        None => (AgentStderrTail::default(), None),
    };

    Ok(SpawnedAgentProcess {
        child,
        stdin,
        stdout,
        stderr_tail,
        stderr_done,
    })
}

fn validate_spawn_cwd(spawn_cwd: &Path, spawn_cwd_source: &str) -> Result<(), String> {
    match std::fs::metadata(spawn_cwd) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(format!(
            "{} is not a directory: {}",
            spawn_cwd_label(spawn_cwd_source),
            spawn_cwd.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(format!(
            "{} is missing: {}",
            spawn_cwd_label(spawn_cwd_source),
            spawn_cwd.display()
        )),
        Err(error) => Err(format!(
            "{} cannot be accessed: {} ({error})",
            spawn_cwd_label(spawn_cwd_source),
            spawn_cwd.display()
        )),
    }
}

fn spawn_cwd_label(spawn_cwd_source: &str) -> &'static str {
    match spawn_cwd_source {
        "agent_override" => "agent launch directory",
        _ => "workspace directory",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::model::{
        ArtifactRole, CredentialState, ResolvedAgentStatus, ResolvedArtifact,
    };
    use crate::domains::agents::registry::built_in_registry;

    fn resolved_test_agent() -> ResolvedAgent {
        let descriptor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Codex)
            .expect("missing codex descriptor");

        ResolvedAgent {
            descriptor,
            status: ResolvedAgentStatus::Ready,
            credential_state: CredentialState::Ready,
            auth_slots: Vec::new(),
            native: None,
            agent_process: ResolvedArtifact {
                role: ArtifactRole::AgentProcess,
                installed: true,
                source: Some("managed".into()),
                version: None,
                path: Some(std::env::current_exe().expect("current exe")),
                message: None,
            },
            spawn: None,
        }
    }

    #[test]
    fn missing_workspace_directory_returns_clear_startup_error() {
        let missing_workspace = std::env::temp_dir().join(format!(
            "anyharness-missing-workspace-{}",
            uuid::Uuid::new_v4()
        ));
        let agent = resolved_test_agent();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();

        let result = spawn_agent_process(
            &agent,
            &missing_workspace,
            &BTreeMap::new(),
            &BTreeMap::new(),
            "session-1",
            "workspace-1",
            AgentKind::Codex.as_str(),
            &ready_tx,
        );
        let error = match result {
            Ok(_) => panic!("missing cwd should fail before spawn"),
            Err(error) => error,
        };

        let message = error.to_string();
        assert!(message.contains("workspace directory is missing"));
        assert!(message.contains(&missing_workspace.display().to_string()));

        let ready_error = ready_rx
            .try_recv()
            .expect("ready failure")
            .expect_err("startup should report cwd failure");
        let ready_message = ready_error.to_string();
        assert!(ready_message.contains("workspace directory is missing"));
        assert!(ready_message.contains(&missing_workspace.display().to_string()));
    }

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

        let merged = merge_spawn_env(&workspace_env, &session_launch_env, None);

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

        let merged = merge_spawn_env(&workspace_env, &session_launch_env, Some(&override_env));

        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
        assert_eq!(merged.get("DEBUG").map(String::as_str), Some("1"));
        assert_eq!(merged.get("FOO").map(String::as_str), Some("bar"));
    }
}
