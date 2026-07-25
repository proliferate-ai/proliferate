use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use super::*;
use crate::live::sessions::driver::stderr::{spawn_agent_stderr_logger, AgentStderrTail};
use crate::live::sessions::model::{LaunchEnv, SessionProcessPolicy};
use crate::live::workflows::isolation::{
    spawn_workflow_agent, WorkflowAgentLaunchRequest, WorkflowAgentResourceLimits,
    WorkflowIsolationBroker, WorkflowProcessGroupGuard, WorkflowProcessSubject,
};
use crate::process_env::{complete_workflow_agent_env, remove_runtime_private_env};

pub(in crate::live::sessions) struct SpawnedAgentProcess {
    pub child: tokio::process::Child,
    pub stdin: tokio::process::ChildStdin,
    pub stdout: tokio::process::ChildStdout,
    pub stderr_tail: AgentStderrTail,
    /// Completes when the stderr pipe reaches EOF (shortly after child exit).
    pub stderr_done: Option<tokio::task::JoinHandle<()>>,
    pub workflow_process_group: Option<WorkflowProcessGroupGuard>,
}

pub(in crate::live::sessions) fn merge_spawn_env(
    launch_env: &LaunchEnv,
    override_env: Option<&HashMap<String, String>>,
) -> BTreeMap<String, String> {
    let mut merged = launch_env.workspace.clone();
    for (key, value) in &launch_env.session {
        merged.insert(key.clone(), value.clone());
    }
    for (key, value) in &launch_env.route_auth {
        merged.insert(key.clone(), value.clone());
    }
    for (key, value) in &launch_env.settings {
        merged.insert(key.clone(), value.clone());
    }
    if let Some(override_env) = override_env {
        for (key, value) in override_env {
            merged.insert(key.clone(), value.clone());
        }
    }
    // Route-auth removals win over every set layer. The ambient (inherited)
    // copies are stripped separately via `Command::env_remove` at spawn.
    for key in &launch_env.route_auth_remove {
        merged.remove(key);
    }
    merged
}

pub(in crate::live::sessions) async fn spawn_agent_process(
    agent: &ResolvedAgent,
    workspace_path: &Path,
    launch_env: &LaunchEnv,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    process_policy: &SessionProcessPolicy,
    workflow_isolation_broker: &std::sync::Arc<dyn WorkflowIsolationBroker>,
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
    let spawn_env = merge_spawn_env(launch_env, spawn_spec.map(|spec| &spec.env));
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
    let (child, workflow_process_group) = match process_policy {
        SessionProcessPolicy::Interactive => {
            let mut command = tokio::process::Command::new(spawn_program);
            command
                .args(spawn_args)
                .args(&launch_env.settings_extra_args)
                .envs(&spawn_env)
                .current_dir(spawn_cwd)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);
            remove_runtime_private_env(&mut command);
            // Agent-auth sanitization: removal wins over the inherited ambient env
            // (for example, an exported provider-routing flag).
            for key in &launch_env.route_auth_remove {
                command.env_remove(key);
            }
            (command.spawn(), None)
        }
        SessionProcessPolicy::Workflow {
            identity,
            capability,
        } => {
            if launch_env.route_auth.is_empty() {
                anyhow::bail!(
                    "workflow agent launch requires an explicitly resolved model route; native/shared-home auth is unavailable"
                );
            }
            match identity.subject() {
                WorkflowProcessSubject::Session {
                    session_id: attested_session_id,
                    ..
                } if attested_session_id == session_id => {}
                _ => anyhow::bail!(
                    "workflow agent isolation identity does not match session {session_id}"
                ),
            }
            let mut args = spawn_args.to_vec();
            args.extend(launch_env.settings_extra_args.iter().cloned());
            let request = WorkflowAgentLaunchRequest {
                identity: identity.clone(),
                program: spawn_program.to_path_buf(),
                args,
                cwd: spawn_cwd.to_path_buf(),
                env: complete_workflow_agent_env(
                    source_agent_kind,
                    &launch_env.workspace,
                    &launch_env.session,
                    &launch_env.route_auth,
                    &launch_env.settings,
                )
                .map_err(anyhow::Error::msg)?,
                resources: WorkflowAgentResourceLimits::phase_a_maximums(),
            };
            let brokered =
                spawn_workflow_agent(workflow_isolation_broker.as_ref(), capability, request)
                    .await?;
            let guard = WorkflowProcessGroupGuard::new(
                workflow_isolation_broker.clone(),
                capability.clone(),
                brokered.process_group,
            );
            (Ok(brokered.child), Some(guard))
        }
    };
    let mut child = child.map_err(|e| {
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
        workflow_process_group,
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
            cli_auth_state: None,
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

    #[tokio::test]
    async fn missing_workspace_directory_returns_clear_startup_error() {
        let missing_workspace = std::env::temp_dir().join(format!(
            "anyharness-missing-workspace-{}",
            uuid::Uuid::new_v4()
        ));
        let agent = resolved_test_agent();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let unavailable_broker: std::sync::Arc<dyn WorkflowIsolationBroker> = std::sync::Arc::new(
            crate::live::workflows::isolation::UnavailableWorkflowIsolationBroker,
        );

        let result = spawn_agent_process(
            &agent,
            &missing_workspace,
            &LaunchEnv::default(),
            "session-1",
            "workspace-1",
            AgentKind::Codex.as_str(),
            &SessionProcessPolicy::Interactive,
            &unavailable_broker,
            &ready_tx,
        )
        .await;
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

    #[tokio::test]
    async fn workflow_policy_never_falls_back_to_direct_agent_spawn() {
        let workspace = std::env::temp_dir().join(format!(
            "anyharness-workflow-spawn-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&workspace).expect("workspace");
        let agent = resolved_test_agent();
        let (ready_tx, _ready_rx) = std::sync::mpsc::channel();
        let unavailable_broker: std::sync::Arc<dyn WorkflowIsolationBroker> = std::sync::Arc::new(
            crate::live::workflows::isolation::UnavailableWorkflowIsolationBroker,
        );
        let delivery = crate::live::workflows::isolation::WorkflowDeliveryIdentity::try_new(
            "run-1",
            Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
            Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
            Some(1),
        )
        .expect("delivery identity");
        let policy = SessionProcessPolicy::Workflow {
            identity: crate::live::workflows::isolation::WorkflowProcessIdentity::new(
                delivery,
                crate::live::workflows::isolation::WorkflowProcessSubject::Session {
                    slot_id: "main".to_string(),
                    session_id: "session-1".to_string(),
                    root: workspace.clone(),
                },
            ),
            capability: crate::live::workflows::isolation::test_isolation_capability(
                crate::live::workflows::isolation::WorkflowDeliveryIdentity::try_new(
                    "run-1",
                    Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
                    Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
                    Some(1),
                )
                .expect("capability delivery identity"),
            ),
        };

        let error = match spawn_agent_process(
            &agent,
            &workspace,
            &LaunchEnv::default(),
            "session-1",
            "workspace-1",
            AgentKind::Codex.as_str(),
            &policy,
            &unavailable_broker,
            &ready_tx,
        )
        .await
        {
            Ok(_) => panic!("workflow policy must not use the direct launcher"),
            Err(error) => error,
        };
        assert!(error
            .to_string()
            .contains("explicitly resolved model route"));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn merge_spawn_env_prefers_session_launch_over_workspace_env() {
        let launch_env = LaunchEnv {
            workspace: BTreeMap::from([
                (
                    "CLAUDE_CODE_EXECUTABLE".to_string(),
                    "/workspace/bin/claude".to_string(),
                ),
                ("PATH".to_string(), "/usr/bin".to_string()),
            ]),
            session: BTreeMap::from([(
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/managed/bin/claude".to_string(),
            )]),
            ..Default::default()
        };

        let merged = merge_spawn_env(&launch_env, None);

        assert_eq!(
            merged.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
            Some("/managed/bin/claude")
        );
        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
    }

    #[test]
    fn merge_spawn_env_prefers_explicit_override_env_over_session_env() {
        let launch_env = LaunchEnv {
            workspace: BTreeMap::from([("PATH".to_string(), "/usr/bin".to_string())]),
            session: BTreeMap::from([("DEBUG".to_string(), "0".to_string())]),
            ..Default::default()
        };
        let override_env = std::collections::HashMap::from([
            ("DEBUG".to_string(), "1".to_string()),
            ("FOO".to_string(), "bar".to_string()),
        ]);

        let merged = merge_spawn_env(&launch_env, Some(&override_env));

        assert_eq!(merged.get("PATH").map(String::as_str), Some("/usr/bin"));
        assert_eq!(merged.get("DEBUG").map(String::as_str), Some("1"));
        assert_eq!(merged.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn merge_spawn_env_route_auth_layer_wins_over_session_layer() {
        let launch_env = LaunchEnv {
            session: BTreeMap::from([(
                "CODEX_HOME".to_string(),
                "/runtime/agent-auth/codex-local".to_string(),
            )]),
            route_auth: BTreeMap::from([
                (
                    "CODEX_HOME".to_string(),
                    "/runtime/agent-auth/codex-home-42".to_string(),
                ),
                (
                    "PROLIFERATE_GATEWAY_KEY".to_string(),
                    "sk-virtual".to_string(),
                ),
            ]),
            ..Default::default()
        };

        let merged = merge_spawn_env(&launch_env, None);

        assert_eq!(
            merged.get("CODEX_HOME").map(String::as_str),
            Some("/runtime/agent-auth/codex-home-42")
        );
        assert_eq!(
            merged.get("PROLIFERATE_GATEWAY_KEY").map(String::as_str),
            Some("sk-virtual")
        );
    }

    #[test]
    fn merge_spawn_env_route_auth_removals_strip_every_set_layer() {
        let launch_env = LaunchEnv {
            workspace: BTreeMap::from([(
                "ANTHROPIC_API_KEY".to_string(),
                "sk-workspace-stale".to_string(),
            )]),
            session: BTreeMap::from([("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string())]),
            route_auth: BTreeMap::from([(
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                "sk-virtual".to_string(),
            )]),
            route_auth_remove: vec![
                "ANTHROPIC_API_KEY".to_string(),
                "CLAUDE_CODE_USE_BEDROCK".to_string(),
            ],
            ..Default::default()
        };

        let merged = merge_spawn_env(&launch_env, None);

        assert!(!merged.contains_key("ANTHROPIC_API_KEY"));
        assert!(!merged.contains_key("CLAUDE_CODE_USE_BEDROCK"));
        assert_eq!(
            merged.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-virtual")
        );
    }

    #[test]
    fn workflow_agent_direct_route_is_hard_unavailable() {
        let launch_env = LaunchEnv {
            workspace: BTreeMap::from([
                ("PATH".to_string(), "/usr/bin".to_string()),
                (
                    "ANYHARNESS_SECRET_CANARY".to_string(),
                    "workspace-leak".to_string(),
                ),
            ]),
            session: BTreeMap::from([(
                "PROLIFERATE_PRIVATE_CALLBACK_URL".to_string(),
                "https://private.invalid/callback".to_string(),
            )]),
            route_auth: BTreeMap::from([(
                "OPENAI_API_KEY".to_string(),
                "selected-route-key".to_string(),
            )]),
            ..Default::default()
        };
        let error = complete_workflow_agent_env(
            AgentKind::Codex.as_str(),
            &launch_env.workspace,
            &launch_env.session,
            &launch_env.route_auth,
            &launch_env.settings,
        )
        .expect_err("direct route must not construct workflow authority");
        assert!(error.contains("run/slot/session/attempt-bound"));
    }
}
