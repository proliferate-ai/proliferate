use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use anyharness_contract::v1::SessionExecutionPhase;

use crate::sessions::runtime::SessionRuntime;
use crate::sessions::service::SessionService;
use crate::terminals::model::TerminalStatus;
use crate::terminals::TerminalService;
use crate::workspaces::managed_root::managed_worktrees_root;
use crate::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::workspaces::runtime::WorkspaceRuntime;

use super::model::{
    PrepareStopInput, PrepareStopSnapshot, RuntimeActivitySnapshot, RuntimeInventoryCapabilities,
    RuntimeInventorySnapshot, RuntimeOperationCount, RuntimeReadinessEntry, RuntimeToolVersions,
    RuntimeWorkspaceRoot, SafeStopBlocker, SafeStopBlockerCode, SafeStopState,
};
use super::readiness::collect_provider_readiness;

#[derive(Clone)]
pub struct RuntimeInventoryService {
    runtime_home: PathBuf,
    workspace_runtime: Arc<WorkspaceRuntime>,
    session_runtime: Arc<SessionRuntime>,
    session_service: Arc<SessionService>,
    terminal_service: Arc<TerminalService>,
    workspace_operation_gate: Arc<WorkspaceOperationGate>,
}

impl RuntimeInventoryService {
    pub fn new(
        runtime_home: PathBuf,
        workspace_runtime: Arc<WorkspaceRuntime>,
        session_runtime: Arc<SessionRuntime>,
        session_service: Arc<SessionService>,
        terminal_service: Arc<TerminalService>,
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        Self {
            runtime_home,
            workspace_runtime,
            session_runtime,
            session_service,
            terminal_service,
            workspace_operation_gate,
        }
    }

    pub async fn inventory(&self) -> RuntimeInventorySnapshot {
        let mut collection_errors = Vec::new();
        let workspaces = match self.workspace_runtime.list_workspaces() {
            Ok(workspaces) => workspaces,
            Err(error) => {
                collection_errors.push(format!("workspace inventory unavailable: {error}"));
                Vec::new()
            }
        };
        let managed_root = managed_worktrees_root(&self.runtime_home);
        let managed_workspace_count = workspaces
            .iter()
            .filter(|workspace| Path::new(&workspace.path).starts_with(&managed_root))
            .count();
        let mut workspace_roots = vec![RuntimeWorkspaceRoot {
            path: managed_root.display().to_string(),
            kind: "managed_worktrees".to_string(),
            workspace_count: managed_workspace_count,
        }];
        workspace_roots.extend(local_workspace_roots(&workspaces, &managed_root));

        RuntimeInventorySnapshot {
            reported_at: now_rfc3339(),
            runtime_version: env!("CARGO_PKG_VERSION").to_string(),
            runtime_home: self.runtime_home.display().to_string(),
            os_kind: std::env::consts::OS.to_string(),
            os_version: os_version(),
            arch: std::env::consts::ARCH.to_string(),
            distro: linux_distro(),
            shell: default_shell(),
            package_managers: package_managers(),
            workspace_roots,
            capabilities: RuntimeInventoryCapabilities {
                supports_process_spawn: true,
                supports_pty: true,
                supports_filesystem: true,
                supports_git: command_exists("git"),
                supports_network_egress: false,
                supports_port_forwarding: false,
                supports_browser: false,
                supports_computer_use: false,
                supports_docker: command_exists("docker"),
            },
            versions: RuntimeToolVersions {
                node_version: command_version("node", &["--version"]),
                npm_version: command_version("npm", &["--version"]),
                python_version: command_version("python3", &["--version"])
                    .or_else(|| command_version("python", &["--version"])),
                uv_version: command_version("uv", &["--version"]),
                git_version: command_version("git", &["--version"]),
            },
            provider_readiness: collect_provider_readiness(&self.runtime_home),
            mcp_readiness: Vec::<RuntimeReadinessEntry>::new(),
            agent_catalog_revision: None,
            collection_errors,
        }
    }

    pub async fn activity(&self, workspace_ids: Option<&[String]>) -> RuntimeActivitySnapshot {
        let mut collection_errors = Vec::new();
        let mut scoped_workspace_ids = workspace_ids
            .map(|ids| {
                ids.iter()
                    .map(|id| id.trim())
                    .filter(|id| !id.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<BTreeSet<_>>()
            })
            .unwrap_or_default();

        if workspace_ids.is_none() {
            match self.workspace_runtime.list_workspaces() {
                Ok(workspaces) => {
                    for workspace in &workspaces {
                        scoped_workspace_ids.insert(workspace.id.clone());
                    }
                }
                Err(error) => {
                    collection_errors.push(format!("workspace activity unavailable: {error}"));
                }
            }
        }

        let sessions = match self.session_service.list_sessions(None, true) {
            Ok(sessions) => sessions
                .into_iter()
                .filter(|session| {
                    workspace_ids.is_none() || scoped_workspace_ids.contains(&session.workspace_id)
                })
                .collect::<Vec<_>>(),
            Err(error) => {
                collection_errors.push(format!("session activity unavailable: {error}"));
                Vec::new()
            }
        };

        for session in &sessions {
            scoped_workspace_ids.insert(session.workspace_id.clone());
        }

        let mut active_session_count = 0usize;
        let mut active_turn_count = 0usize;
        let mut pending_interaction_count = 0usize;
        let mut pending_prompt_count = 0usize;

        for session in &sessions {
            let summary = self
                .session_runtime
                .session_execution_summary(session)
                .await;
            if summary.has_live_handle {
                active_session_count += 1;
            }
            if matches!(
                summary.phase,
                SessionExecutionPhase::Starting | SessionExecutionPhase::Running
            ) {
                active_turn_count += 1;
            }
            pending_interaction_count += summary.pending_interactions.len();
            match self
                .session_service
                .store()
                .list_pending_prompts(&session.id)
            {
                Ok(prompts) => pending_prompt_count += prompts.len(),
                Err(error) => collection_errors.push(format!(
                    "pending prompts unavailable for session {}: {error}",
                    session.id
                )),
            }
        }

        let mut active_terminal_count = 0usize;
        let mut active_process_count = 0usize;
        let mut operation_count_by_kind = BTreeMap::<String, usize>::new();
        for workspace_id in &scoped_workspace_ids {
            let terminals = self.terminal_service.list_terminals(workspace_id).await;
            active_terminal_count += terminals
                .iter()
                .filter(|terminal| {
                    matches!(
                        terminal.status,
                        TerminalStatus::Starting | TerminalStatus::Running
                    )
                })
                .count();

            let operation_snapshot = self.workspace_operation_gate.snapshot(workspace_id).await;
            active_process_count += operation_snapshot.count(WorkspaceOperationKind::ProcessRun);
            for (kind, count) in operation_snapshot.holders {
                let kind = operation_kind_label(kind).to_string();
                *operation_count_by_kind.entry(kind).or_default() += count;
            }
        }

        let operation_counts = operation_count_by_kind
            .into_iter()
            .map(|(kind, count)| RuntimeOperationCount { kind, count })
            .collect::<Vec<_>>();
        let workspace_operation_count = operation_counts.iter().map(|entry| entry.count).sum();
        let safe_stop_reasons = safe_stop_reasons(
            active_session_count,
            active_turn_count,
            pending_interaction_count,
            pending_prompt_count,
            active_terminal_count,
            active_process_count,
            workspace_operation_count,
            &collection_errors,
        );
        let safe_stop_state = if has_blocking_work(&safe_stop_reasons) {
            SafeStopState::Blocked
        } else if collection_errors.is_empty() {
            SafeStopState::Safe
        } else {
            SafeStopState::Unknown
        };

        RuntimeActivitySnapshot {
            reported_at: now_rfc3339(),
            workspace_count: scoped_workspace_ids.len(),
            total_session_count: sessions.len(),
            active_session_count,
            active_turn_count,
            pending_interaction_count,
            pending_prompt_count,
            active_terminal_count,
            active_process_count,
            workspace_operation_count,
            operation_counts,
            safe_stop_state,
            safe_stop_reasons,
            collection_errors,
        }
    }

    pub async fn prepare_stop(&self, input: PrepareStopInput) -> PrepareStopSnapshot {
        let activity = self.activity(input.workspace_ids.as_deref()).await;
        let blockers = activity
            .safe_stop_reasons
            .iter()
            .filter(|reason| reason.code != SafeStopBlockerCode::RuntimeStateUnavailable)
            .cloned()
            .collect::<Vec<_>>();
        let safe_stop_state = activity.safe_stop_state;
        let message = match safe_stop_state {
            SafeStopState::Safe => input.reason.map(|reason| format!("safe to stop: {reason}")),
            SafeStopState::Blocked => Some("runtime has observable active work".to_string()),
            SafeStopState::Unknown => {
                Some("runtime stop safety could not be fully determined".to_string())
            }
        };
        let message = if input.force.unwrap_or(false) && safe_stop_state != SafeStopState::Safe {
            Some(match message {
                Some(message) => {
                    format!("{message}; force was requested but no stop was performed")
                }
                None => "force was requested but no stop was performed".to_string(),
            })
        } else {
            message
        };

        PrepareStopSnapshot {
            prepared_at: now_rfc3339(),
            safe_stop_state,
            blockers,
            activity,
            message,
        }
    }
}

fn safe_stop_reasons(
    active_session_count: usize,
    active_turn_count: usize,
    pending_interaction_count: usize,
    pending_prompt_count: usize,
    active_terminal_count: usize,
    active_process_count: usize,
    workspace_operation_count: usize,
    collection_errors: &[String],
) -> Vec<SafeStopBlocker> {
    let mut reasons = Vec::new();
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::ActiveSession,
        active_session_count,
        "live sessions are still attached",
    );
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::ActiveTurn,
        active_turn_count,
        "session turns are still running",
    );
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::PendingInteraction,
        pending_interaction_count,
        "sessions are waiting for interaction",
    );
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::PendingPrompt,
        pending_prompt_count,
        "sessions have queued prompts",
    );
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::ActiveTerminal,
        active_terminal_count,
        "terminals are still active",
    );
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::ActiveProcess,
        active_process_count,
        "process commands are still running",
    );
    push_count_blocker(
        &mut reasons,
        SafeStopBlockerCode::WorkspaceOperationInProgress,
        workspace_operation_count,
        "workspace operations are still in progress",
    );
    for error in collection_errors {
        reasons.push(SafeStopBlocker {
            code: SafeStopBlockerCode::RuntimeStateUnavailable,
            message: error.clone(),
            count: 1,
            workspace_id: None,
            session_id: None,
            terminal_id: None,
            operation: None,
        });
    }
    reasons
}

fn push_count_blocker(
    reasons: &mut Vec<SafeStopBlocker>,
    code: SafeStopBlockerCode,
    count: usize,
    message: &str,
) {
    if count == 0 {
        return;
    }
    reasons.push(SafeStopBlocker {
        code,
        message: message.to_string(),
        count,
        workspace_id: None,
        session_id: None,
        terminal_id: None,
        operation: None,
    });
}

fn has_blocking_work(reasons: &[SafeStopBlocker]) -> bool {
    reasons
        .iter()
        .any(|reason| reason.code != SafeStopBlockerCode::RuntimeStateUnavailable)
}

fn local_workspace_roots(
    workspaces: &[crate::workspaces::model::WorkspaceRecord],
    managed_root: &Path,
) -> Vec<RuntimeWorkspaceRoot> {
    let mut counts = BTreeMap::<String, usize>::new();
    for workspace in workspaces {
        let path = Path::new(&workspace.path);
        if path.starts_with(managed_root) {
            continue;
        }
        let root = workspace.source_repo_root_path.as_str();
        *counts.entry(root.to_string()).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(path, workspace_count)| RuntimeWorkspaceRoot {
            path,
            kind: "source_repo".to_string(),
            workspace_count,
        })
        .collect()
}

fn package_managers() -> Vec<String> {
    [
        "brew", "apt", "dnf", "yum", "pacman", "npm", "pnpm", "uv", "cargo", "pip",
    ]
    .into_iter()
    .filter(|command| command_exists(command))
    .map(str::to_string)
    .collect()
}

fn default_shell() -> String {
    std::env::var("SHELL")
        .or_else(|_| std::env::var("COMSPEC"))
        .ok()
        .filter(|shell| !shell.trim().is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn os_version() -> Option<String> {
    if cfg!(target_os = "macos") {
        return command_version("sw_vers", &["-productVersion"]);
    }
    if cfg!(target_os = "linux") {
        return os_release_field("VERSION_ID").or_else(|| os_release_field("PRETTY_NAME"));
    }
    if cfg!(target_os = "windows") {
        return command_version("cmd", &["/C", "ver"]);
    }
    None
}

fn linux_distro() -> Option<String> {
    if cfg!(target_os = "linux") {
        os_release_field("ID").or_else(|| os_release_field("NAME"))
    } else {
        None
    }
}

fn os_release_field(key: &str) -> Option<String> {
    let contents = std::fs::read_to_string("/etc/os-release").ok()?;
    contents.lines().find_map(|line| {
        let (line_key, value) = line.split_once('=')?;
        (line_key == key).then(|| value.trim_matches('"').to_string())
    })
}

fn command_version(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let value = if stdout.trim().is_empty() {
        stderr.trim()
    } else {
        stdout.trim()
    };
    (!value.is_empty()).then(|| value.to_string())
}

fn command_exists(command: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    let candidates = executable_candidates(command);
    std::env::split_paths(&path).any(|dir| {
        candidates
            .iter()
            .any(|candidate| dir.join(candidate).is_file())
    })
}

fn executable_candidates(command: &str) -> Vec<String> {
    if cfg!(windows) && !command.contains('.') {
        let extensions =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        extensions
            .split(';')
            .map(|extension| format!("{command}{extension}"))
            .collect()
    } else {
        vec![command.to_string()]
    }
}

fn operation_kind_label(kind: WorkspaceOperationKind) -> &'static str {
    match kind {
        WorkspaceOperationKind::MaterializationRead => "materialization_read",
        WorkspaceOperationKind::FileWrite => "file_write",
        WorkspaceOperationKind::GitWrite => "git_write",
        WorkspaceOperationKind::ProcessRun => "process_run",
        WorkspaceOperationKind::TerminalCommand => "terminal_command",
        WorkspaceOperationKind::SessionStart => "session_start",
        WorkspaceOperationKind::SessionFork => "session_fork",
        WorkspaceOperationKind::SessionPrompt => "session_prompt",
        WorkspaceOperationKind::SessionResume => "session_resume",
        WorkspaceOperationKind::SetupCommand => "setup_command",
        WorkspaceOperationKind::HostingWrite => "hosting_write",
        WorkspaceOperationKind::PlanWrite => "plan_write",
        WorkspaceOperationKind::ReviewWrite => "review_write",
        WorkspaceOperationKind::CoworkWrite => "cowork_write",
        WorkspaceOperationKind::SubagentWrite => "subagent_write",
        WorkspaceOperationKind::MobilityWrite => "mobility_write",
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
