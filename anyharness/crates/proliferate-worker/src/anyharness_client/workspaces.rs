use std::path::Path;
use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::warn;

use crate::error::WorkerError;

use super::{
    backfill::AnyHarnessWorkspace,
    sessions::{parse_anyharness_response, AnyHarnessCommandResponse},
    AnyHarnessClient,
};

const WORKSPACE_MATERIALIZE_TIMEOUT: Duration = Duration::from_secs(120);
const WORKSPACE_RETIRE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum MaterializeWorkspaceRequest {
    ExistingPath {
        path: String,
        #[serde(rename = "displayName")]
        display_name: Option<String>,
        origin: Option<Value>,
        #[serde(rename = "creatorContext")]
        creator_context: Option<Value>,
    },
    Worktree {
        #[serde(rename = "repoRootId")]
        repo_root_id: String,
        #[serde(rename = "targetPath")]
        target_path: String,
        #[serde(rename = "newBranchName")]
        new_branch_name: String,
        #[serde(rename = "baseBranch")]
        base_branch: Option<String>,
        #[serde(rename = "checkoutMode")]
        checkout_mode: Option<String>,
        #[serde(rename = "setupScript")]
        setup_script: Option<String>,
        #[serde(rename = "nameConflictPolicy")]
        name_conflict_policy: Option<String>,
        origin: Option<Value>,
        #[serde(rename = "creatorContext")]
        creator_context: Option<Value>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedWorkspaceResult {
    pub mode: String,
    pub anyharness_workspace_id: String,
    pub repo_root_id: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

impl MaterializeWorkspaceRequest {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::ExistingPath { .. } => "existing_path",
            Self::Worktree { .. } => "worktree",
        }
    }

    fn repo_root_id_hint(&self) -> Option<&str> {
        match self {
            Self::ExistingPath { .. } => None,
            Self::Worktree { repo_root_id, .. } => Some(repo_root_id.as_str()),
        }
    }

    fn display_name(&self) -> Option<&str> {
        match self {
            Self::ExistingPath { display_name, .. } => display_name.as_deref(),
            Self::Worktree { .. } => None,
        }
    }

    fn anyharness_body(&self) -> Value {
        match self {
            Self::ExistingPath {
                path,
                origin,
                creator_context,
                ..
            } => compact_object(json!({
                "path": expand_home(path),
                "origin": origin,
                "creatorContext": creator_context,
            })),
            Self::Worktree {
                repo_root_id,
                target_path,
                new_branch_name,
                base_branch,
                checkout_mode,
                setup_script,
                name_conflict_policy,
                origin,
                creator_context,
            } => compact_object(json!({
                "repoRootId": repo_root_id,
                "targetPath": expand_home(target_path),
                "newBranchName": new_branch_name,
                "baseBranch": base_branch,
                "checkoutMode": checkout_mode,
                "setupScript": setup_script,
                "nameConflictPolicy": name_conflict_policy,
                "origin": origin,
                "creatorContext": creator_context,
            })),
        }
    }

    fn resolve_body(&self) -> Value {
        match self {
            Self::ExistingPath {
                path,
                origin,
                creator_context,
                ..
            } => compact_object(json!({
                "path": expand_home(path),
                "origin": origin,
                "creatorContext": creator_context,
            })),
            Self::Worktree {
                target_path,
                origin,
                creator_context,
                ..
            } => compact_object(json!({
                "path": expand_home(target_path),
                "origin": origin,
                "creatorContext": creator_context,
            })),
        }
    }

    pub fn materialized_result(
        &self,
        response_body: &Value,
    ) -> Result<MaterializedWorkspaceResult, String> {
        let workspace = response_body
            .get("workspace")
            .ok_or_else(|| "AnyHarness response must contain workspace.".to_string())?;
        let anyharness_workspace_id = required_string(workspace, "id")?;
        let repo_root_id = string_field(workspace, "repoRootId")
            .or_else(|| {
                response_body
                    .get("repoRoot")
                    .and_then(|repo_root| string_field(repo_root, "id"))
            })
            .or_else(|| self.repo_root_id_hint().map(ToOwned::to_owned))
            .ok_or_else(|| {
                "AnyHarness response must contain workspace.repoRootId or repoRoot.id.".to_string()
            })?;
        Ok(MaterializedWorkspaceResult {
            mode: self.mode().to_string(),
            anyharness_workspace_id,
            repo_root_id,
            path: required_string(workspace, "path")?,
            kind: required_string(workspace, "kind")?,
            current_branch: string_field(workspace, "currentBranch"),
            original_branch: string_field(workspace, "originalBranch"),
            display_name: string_field(workspace, "displayName"),
        })
    }

    fn recovered_worktree_is_expected(&self, response_body: &Value) -> bool {
        let Self::Worktree {
            repo_root_id,
            new_branch_name,
            base_branch,
            checkout_mode,
            ..
        } = self
        else {
            return false;
        };
        let Ok(result) = self.materialized_result(response_body) else {
            return false;
        };
        if result.kind != "worktree" || result.repo_root_id != *repo_root_id {
            return false;
        }
        if checkout_mode.as_deref() == Some("detached_ref") {
            let is_detached = matches!(result.current_branch.as_deref(), None | Some("HEAD"));
            if !is_detached {
                return false;
            }
            return match (base_branch.as_deref(), result.original_branch.as_deref()) {
                (Some(expected), Some(original)) => original == expected,
                (Some(_), None) => false,
                _ => true,
            };
        }
        match result.current_branch.as_deref() {
            Some(current_branch) => current_branch == new_branch_name,
            None => true,
        }
    }

    fn recovered_worktree_workspace_is_expected(&self, workspace: &AnyHarnessWorkspace) -> bool {
        let Self::Worktree {
            repo_root_id,
            target_path,
            new_branch_name,
            base_branch,
            checkout_mode,
            name_conflict_policy,
            creator_context,
            ..
        } = self
        else {
            return false;
        };
        if workspace.kind != "worktree" || workspace.repo_root_id != *repo_root_id {
            return false;
        }
        if !workspace_path_matches_target(
            target_path,
            &workspace.path,
            name_conflict_policy_allows_suffix(name_conflict_policy.as_deref()),
        ) {
            return false;
        }
        if let Some(expected_creator_context) = creator_context {
            if workspace.creator_context.as_ref() != Some(expected_creator_context) {
                return false;
            }
        }
        if checkout_mode.as_deref() == Some("detached_ref") {
            let is_detached = matches!(workspace.current_branch.as_deref(), None | Some("HEAD"));
            if !is_detached {
                return false;
            }
            return match (base_branch.as_deref(), workspace.original_branch.as_deref()) {
                (Some(expected), Some(original)) => original == expected,
                (Some(_), None) => false,
                _ => true,
            };
        }
        workspace.current_branch.as_deref() == Some(new_branch_name.as_str())
    }
}

fn expand_home(path: &str) -> String {
    if path == "~" {
        return dirs::home_dir()
            .map(|home| home.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return dirs::home_dir()
            .map(|home| home.join(rest).to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
    }
    path.to_string()
}

fn workspace_path_matches_target(
    target_path: &str,
    workspace_path: &str,
    allow_suffix: bool,
) -> bool {
    let target = normalize_materialized_path(target_path);
    let workspace = normalize_materialized_path(workspace_path);
    if workspace == target {
        return true;
    }
    if !allow_suffix {
        return false;
    }

    let target_path = Path::new(&target);
    let workspace_path = Path::new(&workspace);
    if target_path.parent() != workspace_path.parent() {
        return false;
    }

    let Some(target_name) = target_path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(workspace_name) = workspace_path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(suffix) = workspace_name
        .strip_prefix(target_name)
        .and_then(|rest| rest.strip_prefix('-'))
    else {
        return false;
    };
    !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
}

fn name_conflict_policy_allows_suffix(policy: Option<&str>) -> bool {
    matches!(policy, Some("suffix_path" | "suffix_path_and_branch"))
}

fn normalize_materialized_path(path: &str) -> String {
    expand_home(path).trim_end_matches('/').to_string()
}

impl AnyHarnessClient {
    pub async fn retire_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().post(format!(
                "{}/v1/workspaces/{}/retire",
                self.base_url(),
                workspace_id
            )))
            .timeout(WORKSPACE_RETIRE_TIMEOUT)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn retry_retire_cleanup(
        &self,
        workspace_id: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().post(format!(
                "{}/v1/workspaces/{}/retire/cleanup-retry",
                self.base_url(),
                workspace_id
            )))
            .timeout(WORKSPACE_RETIRE_TIMEOUT)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn materialize_workspace(
        &self,
        request: &MaterializeWorkspaceRequest,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let path = match request {
            MaterializeWorkspaceRequest::ExistingPath { .. } => "/v1/workspaces/resolve",
            MaterializeWorkspaceRequest::Worktree { .. } => "/v1/workspaces/worktrees",
        };
        let response = self
            .authenticate(self.http().post(format!("{}{}", self.base_url(), path)))
            .timeout(WORKSPACE_MATERIALIZE_TIMEOUT)
            .json(&request.anyharness_body())
            .send()
            .await?;
        let mut response = parse_anyharness_response(response).await?;
        if !response.is_success() {
            if let Some(recovered) = self.recover_materialized_workspace(request).await? {
                response = recovered;
            }
        }
        if response.is_success() {
            self.apply_display_name_if_requested(request, &mut response)
                .await?;
        }
        Ok(response)
    }

    async fn recover_materialized_workspace(
        &self,
        request: &MaterializeWorkspaceRequest,
    ) -> Result<Option<AnyHarnessCommandResponse>, WorkerError> {
        if !matches!(request, MaterializeWorkspaceRequest::Worktree { .. }) {
            return Ok(None);
        }
        let response = self
            .authenticate(
                self.http()
                    .post(format!("{}/v1/workspaces/resolve", self.base_url())),
            )
            .timeout(WORKSPACE_MATERIALIZE_TIMEOUT)
            .json(&request.resolve_body())
            .send()
            .await?;
        let response = parse_anyharness_response(response).await?;
        if response.is_success() && request.recovered_worktree_is_expected(&response.body) {
            return Ok(Some(response));
        }
        if let Some(response) = self
            .recover_materialized_worktree_from_list(request)
            .await?
        {
            return Ok(Some(response));
        }
        Ok(None)
    }

    async fn recover_materialized_worktree_from_list(
        &self,
        request: &MaterializeWorkspaceRequest,
    ) -> Result<Option<AnyHarnessCommandResponse>, WorkerError> {
        let workspaces = self.list_workspaces().await?;
        let Some(workspace) = workspaces
            .into_iter()
            .find(|workspace| request.recovered_worktree_workspace_is_expected(workspace))
        else {
            return Ok(None);
        };
        Ok(Some(AnyHarnessCommandResponse {
            status: StatusCode::OK,
            body: json!({ "workspace": workspace }),
        }))
    }

    async fn apply_display_name_if_requested(
        &self,
        request: &MaterializeWorkspaceRequest,
        response: &mut AnyHarnessCommandResponse,
    ) -> Result<(), WorkerError> {
        let Some(display_name) = request
            .display_name()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Ok(());
        };
        let Some(workspace_id) = response
            .body
            .get("workspace")
            .and_then(|workspace| string_field(workspace, "id"))
        else {
            return Ok(());
        };
        let display_response = match self
            .update_workspace_display_name(&workspace_id, display_name)
            .await
        {
            Ok(display_response) => display_response,
            Err(error) => {
                warn!(?error, workspace_id, "failed to set workspace display name");
                return Ok(());
            }
        };
        if display_response.is_success() {
            if let Value::Object(object) = &mut response.body {
                object.insert("workspace".to_string(), display_response.body);
            }
        } else if let Value::Object(object) = &mut response.body {
            object.insert(
                "displayNameUpdate".to_string(),
                json!({
                    "statusCode": display_response.status.as_u16(),
                    "body": display_response.body,
                }),
            );
        }
        Ok(())
    }

    async fn update_workspace_display_name(
        &self,
        workspace_id: &str,
        display_name: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().patch(format!(
                "{}/v1/workspaces/{}/display-name",
                self.base_url(),
                workspace_id
            )))
            .json(&json!({ "displayName": display_name }))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }
}

fn compact_object(value: Value) -> Value {
    let Value::Object(object) = value else {
        return value;
    };
    Value::Object(
        object
            .into_iter()
            .filter(|(_key, value)| !value.is_null())
            .collect(),
    )
}

fn required_string(value: &Value, field: &str) -> Result<String, String> {
    string_field(value, field).ok_or_else(|| format!("AnyHarness response must contain {field}."))
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
#[path = "workspaces_tests.rs"]
mod tests;
