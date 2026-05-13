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
        spawn_spec.map(|spec| &spec.env),
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
