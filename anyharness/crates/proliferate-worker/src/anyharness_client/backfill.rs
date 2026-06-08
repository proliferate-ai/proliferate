use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::debug;

use crate::error::WorkerError;

use super::AnyHarnessClient;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnyHarnessRepoRoot {
    pub id: String,
    pub display_name: Option<String>,
    pub default_branch: Option<String>,
    pub remote_provider: Option<String>,
    pub remote_owner: Option<String>,
    pub remote_repo_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnyHarnessWorkspace {
    pub id: String,
    pub kind: String,
    pub repo_root_id: String,
    pub path: String,
    pub original_branch: Option<String>,
    pub current_branch: Option<String>,
    pub display_name: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnyHarnessSession {
    pub id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    pub native_session_id: Option<String>,
    pub title: Option<String>,
    pub live_config: Option<Value>,
    pub execution_summary: Option<AnyHarnessSessionExecutionSummary>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnyHarnessSessionExecutionSummary {
    pub phase: String,
    #[serde(default)]
    pub pending_interactions: Vec<AnyHarnessPendingInteraction>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnyHarnessPendingInteraction {
    pub request_id: String,
    pub kind: String,
    pub title: String,
    pub description: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct AnyHarnessBackfillSnapshot {
    pub workspaces: Vec<AnyHarnessWorkspace>,
    pub repo_roots_by_id: HashMap<String, AnyHarnessRepoRoot>,
    pub sessions: Vec<AnyHarnessSession>,
}

impl AnyHarnessClient {
    pub async fn backfill_snapshot(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<AnyHarnessBackfillSnapshot, WorkerError> {
        let repo_roots = self.list_repo_roots().await?;
        let repo_roots_by_id = repo_roots
            .into_iter()
            .map(|repo_root| (repo_root.id.clone(), repo_root))
            .collect::<HashMap<_, _>>();
        let mut workspaces = self.list_workspaces().await?;
        if let Some(workspace_id) = workspace_id {
            workspaces.retain(|workspace| workspace.id == workspace_id);
        }
        let mut sessions = self.list_sessions(workspace_id).await?;
        if workspace_id.is_none() {
            let workspace_ids = workspaces
                .iter()
                .map(|workspace| workspace.id.as_str())
                .collect::<std::collections::HashSet<_>>();
            sessions.retain(|session| workspace_ids.contains(session.workspace_id.as_str()));
        }
        debug!(
            workspace_id = workspace_id.unwrap_or("<all>"),
            repo_root_count = repo_roots_by_id.len(),
            workspace_count = workspaces.len(),
            session_count = sessions.len(),
            "anyharness backfill snapshot fetched"
        );
        Ok(AnyHarnessBackfillSnapshot {
            workspaces,
            repo_roots_by_id,
            sessions,
        })
    }

    async fn list_repo_roots(&self) -> Result<Vec<AnyHarnessRepoRoot>, WorkerError> {
        self.get_json("/v1/repo-roots").await
    }

    pub(crate) async fn list_workspaces(&self) -> Result<Vec<AnyHarnessWorkspace>, WorkerError> {
        self.get_json("/v1/workspaces").await
    }

    async fn list_sessions(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Vec<AnyHarnessSession>, WorkerError> {
        let mut request =
            self.authenticate(self.http().get(format!("{}/v1/sessions", self.base_url())));
        if let Some(workspace_id) = workspace_id {
            request = request.query(&[("workspace_id", workspace_id)]);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        Ok(response.json().await?)
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, WorkerError> {
        let response = self
            .authenticate(self.http().get(format!("{}{}", self.base_url(), path)))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        Ok(response.json().await?)
    }
}
