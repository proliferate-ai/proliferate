use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyharness_contract::v1::SessionMcpBindingSummary;
use uuid::Uuid;

use super::mcp_auth::CoworkMcpAuth;
use super::model::{CoworkRootRecord, CoworkThreadRecord};
use super::service::CoworkService;
use crate::git::GitService;
use crate::origin::OriginContext;
use crate::repo_roots::model::{CreateRepoRootInput, RepoRootRecord};
use crate::repo_roots::service::RepoRootService;
use crate::sessions::mcp::{SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer};
use crate::sessions::model::SessionRecord;
use crate::sessions::runtime::{CreateAndStartSessionError, SessionRuntime};
use crate::sessions::service::SessionService;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug, Clone, Default)]
pub struct CoworkSessionLaunchExtras {
    pub system_prompt_append: Vec<String>,
    pub mcp_servers: Vec<SessionMcpServer>,
}

#[derive(Debug)]
pub enum CoworkCreateThreadError {
    NotEnabled,
    Setup(anyhow::Error),
    CreateSession(CreateAndStartSessionError),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for CoworkCreateThreadError {
    fn from(value: anyhow::Error) -> Self {
        Self::Internal(value)
    }
}

#[derive(Debug, Clone)]
pub struct CoworkThreadSummary {
    pub thread: CoworkThreadRecord,
    pub title: Option<String>,
    pub updated_at: String,
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateCoworkThreadResult {
    pub thread: CoworkThreadSummary,
    pub workspace: WorkspaceRecord,
    pub session: SessionRecord,
}

const COWORK_WORKSPACE_PATH_PLACEHOLDER: &str = "__PROLIFERATE_COWORK_WORKSPACE_PATH__";

fn materialize_cowork_workspace_path(mcp_servers: &mut [SessionMcpServer], workspace_path: &str) {
    for server in mcp_servers {
        let SessionMcpServer::Stdio(server) = server else {
            continue;
        };
        for arg in &mut server.args {
            if arg == COWORK_WORKSPACE_PATH_PLACEHOLDER {
                *arg = workspace_path.to_string();
            }
        }
    }
}

#[derive(Clone)]
pub struct CoworkSessionHooks {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    mcp_auth: Arc<CoworkMcpAuth>,
    autosave_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl CoworkSessionHooks {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        mcp_auth: Arc<CoworkMcpAuth>,
    ) -> Self {
        Self {
            runtime_base_url,
            runtime_bearer_token,
            mcp_auth,
            autosave_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn resolve_launch_extras(
        &self,
        workspace: &WorkspaceRecord,
        session_id: &str,
    ) -> anyhow::Result<CoworkSessionLaunchExtras> {
        if workspace.surface != "cowork" {
            return Ok(CoworkSessionLaunchExtras::default());
        }

        let capability_token = self
            .mcp_auth
            .mint_capability_token(&workspace.id, session_id)?;
        let url = format!(
            "{}/v1/workspaces/{}/cowork/sessions/{}/mcp",
            self.runtime_base_url, workspace.id, session_id
        );

        let mut headers = Vec::new();
        if let Some(token) = self.runtime_bearer_token.as_ref() {
            headers.push(SessionMcpHeader {
                name: "authorization".to_string(),
                value: format!("Bearer {token}"),
            });
        }
        headers.push(SessionMcpHeader {
            name: self.mcp_auth.capability_header_name().to_string(),
            value: capability_token,
        });

        Ok(CoworkSessionLaunchExtras {
            system_prompt_append: cowork_artifact_system_prompt_append(),
            mcp_servers: vec![SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: "cowork".to_string(),
                catalog_entry_id: None,
                server_name: "cowork".to_string(),
                url,
                headers,
            })],
        })
    }

    pub fn validate_capability_token(
        &self,
        token: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<bool> {
        self.mcp_auth
            .validate_capability_token(token, workspace_id, session_id)
    }

    pub fn capability_header_name(&self) -> &'static str {
        self.mcp_auth.capability_header_name()
    }

    pub fn notify_turn_finished(&self, workspace: &WorkspaceRecord, session_id: &str) {
        if workspace.surface != "cowork" {
            return;
        }

        let workspace_id = workspace.id.clone();
        let workspace_path = workspace.path.clone();
        let session_id = session_id.to_string();
        let lock = self.autosave_lock(&workspace_id);
        tokio::spawn(async move {
            let _guard = lock.lock().await;
            if let Err(error) = GitService::autosave_cowork_workspace(
                std::path::Path::new(&workspace_path),
                "Cowork autosave",
            ) {
                tracing::warn!(
                    workspace_id = %workspace_id,
                    session_id = %session_id,
                    error = %error,
                    "failed to autosave cowork workspace after turn end"
                );
            }
        });
    }

    fn autosave_lock(&self, workspace_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .autosave_locks
            .lock()
            .expect("cowork autosave lock map should not be poisoned");
        locks
            .entry(workspace_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
}

pub struct CoworkRuntime {
    cowork_service: CoworkService,
    repo_root_service: RepoRootService,
    workspace_runtime: Arc<WorkspaceRuntime>,
    session_service: Arc<SessionService>,
    session_runtime: Arc<SessionRuntime>,
    runtime_home: PathBuf,
}

impl CoworkRuntime {
    pub fn new(
        cowork_service: CoworkService,
        repo_root_service: RepoRootService,
        workspace_runtime: Arc<WorkspaceRuntime>,
        session_service: Arc<SessionService>,
        session_runtime: Arc<SessionRuntime>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            cowork_service,
            repo_root_service,
            workspace_runtime,
            session_service,
            session_runtime,
            runtime_home,
        }
    }

    pub fn get_root(&self) -> anyhow::Result<Option<(CoworkRootRecord, RepoRootRecord)>> {
        let Some(root) = self.cowork_service.get_root()? else {
            return Ok(None);
        };
        let repo_root = self
            .repo_root_service
            .get_repo_root(&root.repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("cowork repo root missing: {}", root.repo_root_id))?;
        Ok(Some((root, repo_root)))
    }

    pub fn status(&self) -> anyhow::Result<(Option<(CoworkRootRecord, RepoRootRecord)>, usize)> {
        let root = self.get_root()?;
        let thread_count = self.cowork_service.list_threads()?.len();
        Ok((root, thread_count))
    }

    pub fn ensure_root(&self) -> anyhow::Result<(CoworkRootRecord, RepoRootRecord)> {
        if let Some(root) = self.get_root()? {
            return Ok(root);
        }

        let repo_path = self.runtime_home.join("cowork").join("root");
        ensure_managed_repo(&repo_path)?;
        let repo_root = self
            .repo_root_service
            .ensure_repo_root(CreateRepoRootInput {
                kind: "managed".into(),
                path: repo_path.display().to_string(),
                display_name: Some("Cowork".into()),
                default_branch: Some("main".into()),
                remote_provider: None,
                remote_owner: None,
                remote_repo_name: None,
                remote_url: None,
            })?;
        let root = self.cowork_service.upsert_root(&repo_root.id)?;
        Ok((root, repo_root))
    }

    pub fn enable(&self) -> anyhow::Result<(CoworkRootRecord, RepoRootRecord)> {
        self.ensure_root()
    }

    pub async fn create_thread(
        &self,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        mut mcp_servers: Vec<SessionMcpServer>,
        mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
    ) -> Result<CreateCoworkThreadResult, CoworkCreateThreadError> {
        let total_started = Instant::now();
        let mcp_server_count = mcp_servers.len();
        tracing::info!(
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            mcp_server_count,
            "[workspace-latency] cowork.runtime.create_thread.start"
        );

        let (root, repo_root) = self.ensure_root().map_err(CoworkCreateThreadError::Setup)?;

        let thread_id = Uuid::new_v4().to_string();
        let branch_name = format!("thread/{thread_id}");
        let thread_path = self
            .runtime_home
            .join("cowork")
            .join("threads")
            .join(&thread_id);
        if let Some(parent) = thread_path.parent() {
            fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }

        let worktree_started = Instant::now();
        let worktree = self.workspace_runtime.create_worktree_with_surface(
            &repo_root.id,
            &thread_path.display().to_string(),
            &branch_name,
            Some(repo_root.default_branch.as_deref().unwrap_or("main")),
            None,
            "cowork",
            OriginContext::cowork(),
        )?;
        tracing::info!(
            thread_id = %thread_id,
            workspace_id = %worktree.workspace.id,
            elapsed_ms = worktree_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.worktree_created"
        );
        materialize_cowork_workspace_path(&mut mcp_servers, &worktree.workspace.path);
        let durable_create_started = Instant::now();
        let durable_session = match self.session_runtime.create_durable_session(
            &worktree.workspace.id,
            agent_kind,
            model_id,
            mode_id,
            None,
            mcp_servers,
            mcp_binding_summaries,
            OriginContext::cowork(),
        ) {
            Ok(session) => session,
            Err(error) => {
                self.cleanup_failed_thread_bootstrap(
                    &repo_root,
                    &worktree.workspace,
                    None,
                    &thread_path,
                );
                return Err(CoworkCreateThreadError::CreateSession(error));
            }
        };
        tracing::info!(
            thread_id = %thread_id,
            workspace_id = %worktree.workspace.id,
            session_id = %durable_session.id,
            elapsed_ms = durable_create_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.durable_session_created"
        );

        let thread_record = CoworkThreadRecord {
            id: thread_id.clone(),
            repo_root_id: root.repo_root_id.clone(),
            workspace_id: worktree.workspace.id.clone(),
            session_id: durable_session.id.clone(),
            agent_kind: agent_kind.to_string(),
            requested_model_id: model_id.map(str::to_string),
            branch_name,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let thread = match self.cowork_service.create_thread(thread_record) {
            Ok(thread) => thread,
            Err(error) => {
                self.cleanup_failed_thread_bootstrap(
                    &repo_root,
                    &worktree.workspace,
                    Some(&durable_session),
                    &thread_path,
                );
                return Err(CoworkCreateThreadError::Internal(error));
            }
        };
        let start_started = Instant::now();
        let session = match self.session_runtime.start_persisted_session(&durable_session, None).await {
            Ok(session) => session,
            Err(error) => self
                .session_service
                .get_session(&durable_session.id)?
                .unwrap_or_else(|| {
                    tracing::warn!(
                        session_id = %durable_session.id,
                        workspace_id = %worktree.workspace.id,
                        error = ?error,
                        "cowork thread session disappeared after start failure; returning durable record"
                    );
                    durable_session.clone()
                }),
        };
        tracing::info!(
            thread_id = %thread_id,
            workspace_id = %worktree.workspace.id,
            session_id = %session.id,
            native_session_id = %session.native_session_id.as_deref().unwrap_or_default(),
            start_elapsed_ms = start_started.elapsed().as_millis(),
            total_elapsed_ms = total_started.elapsed().as_millis(),
            "[workspace-latency] cowork.runtime.create_thread.completed"
        );

        Ok(CreateCoworkThreadResult {
            thread: CoworkThreadSummary {
                thread,
                title: session.title.clone(),
                updated_at: session.updated_at.clone(),
                last_activity_at: session.last_prompt_at.clone(),
            },
            workspace: worktree.workspace,
            session,
        })
    }

    pub fn list_threads(&self) -> anyhow::Result<Vec<CoworkThreadSummary>> {
        let mut threads = self
            .cowork_service
            .list_threads()?
            .into_iter()
            .map(|thread| {
                let session = self
                    .session_service
                    .get_session(&thread.session_id)?
                    .ok_or_else(|| {
                        anyhow::anyhow!("session missing for cowork thread {}", thread.id)
                    })?;
                Ok(CoworkThreadSummary {
                    title: session.title.clone(),
                    updated_at: session.updated_at.clone(),
                    last_activity_at: session.last_prompt_at.clone(),
                    thread,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        threads.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(threads)
    }

    fn cleanup_failed_thread_bootstrap(
        &self,
        repo_root: &RepoRootRecord,
        workspace: &WorkspaceRecord,
        session: Option<&SessionRecord>,
        thread_path: &PathBuf,
    ) {
        if let Some(session) = session {
            if let Err(error) = self.session_service.store().delete_session(&session.id) {
                tracing::warn!(
                    session_id = %session.id,
                    workspace_id = %workspace.id,
                    error = %error,
                    "failed to clean up cowork session after bootstrap failure"
                );
            }
        }

        if let Err(error) = self.workspace_runtime.cleanup_failed_worktree(
            &repo_root.path,
            &workspace.id,
            &thread_path.display().to_string(),
        ) {
            tracing::warn!(
                workspace_id = %workspace.id,
                repo_root_id = %repo_root.id,
                path = %thread_path.display(),
                error = %error,
                "failed to clean up cowork worktree after bootstrap failure"
            );
        }
    }
}

fn cowork_artifact_system_prompt_append() -> Vec<String> {
    vec![
        "You are operating in Proliferate Cowork mode.".to_string(),
        "This session belongs to a managed cowork thread workspace.".to_string(),
        "Continue work in this thread unless the user explicitly asks to start a new thread."
            .to_string(),
        "Use create_artifact, update_artifact, and delete_artifact for user-visible artifacts."
            .to_string(),
        "Never edit .proliferate/artifacts.json directly.".to_string(),
        "Do not use generic file writes on artifact-backed paths.".to_string(),
        "Use normal file tools only for supporting non-artifact files.".to_string(),
        "JSX artifacts must default-export a React component with no required props.".to_string(),
        "JSX artifacts may only import allowlisted libraries.".to_string(),
    ]
}

fn ensure_managed_repo(path: &PathBuf) -> anyhow::Result<()> {
    fs::create_dir_all(path)?;
    if path.join(".git").exists() {
        return Ok(());
    }

    run_git(None, ["init", "-b", "main", &path.display().to_string()])?;
    run_git(Some(path), ["config", "user.name", "AnyHarness"])?;
    run_git(
        Some(path),
        ["config", "user.email", "anyharness@local.invalid"],
    )?;
    run_git(
        Some(path),
        ["commit", "--allow-empty", "-m", "Initialize cowork root"],
    )?;
    Ok(())
}

fn run_git<const N: usize>(cwd: Option<&PathBuf>, args: [&str; N]) -> anyhow::Result<()> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }

    anyhow::bail!(
        "git command failed: git {}: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(test)]
mod tests {
    use super::{materialize_cowork_workspace_path, COWORK_WORKSPACE_PATH_PLACEHOLDER};
    use crate::sessions::mcp::{SessionMcpServer, SessionMcpStdioServer};

    #[test]
    fn materializes_cowork_workspace_path_in_stdio_args() {
        let mut servers = vec![SessionMcpServer::Stdio(SessionMcpStdioServer {
            connection_id: "filesystem-1".to_string(),
            catalog_entry_id: Some("filesystem".to_string()),
            server_name: "filesystem".to_string(),
            command: "filesystem".to_string(),
            args: vec![COWORK_WORKSPACE_PATH_PLACEHOLDER.to_string()],
            env: vec![],
        })];

        materialize_cowork_workspace_path(&mut servers, "/tmp/cowork/thread-1");

        let SessionMcpServer::Stdio(server) = &servers[0] else {
            panic!("expected stdio server");
        };
        assert_eq!(server.args, vec!["/tmp/cowork/thread-1"]);
    }
}
