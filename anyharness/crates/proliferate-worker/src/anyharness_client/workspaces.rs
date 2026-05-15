use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::warn;

use crate::error::WorkerError;

use super::{
    sessions::{parse_anyharness_response, AnyHarnessCommandResponse},
    AnyHarnessClient,
};

const WORKSPACE_MATERIALIZE_TIMEOUT: Duration = Duration::from_secs(120);

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
        #[serde(rename = "setupScript")]
        setup_script: Option<String>,
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
                "path": path,
                "origin": origin,
                "creatorContext": creator_context,
            })),
            Self::Worktree {
                repo_root_id,
                target_path,
                new_branch_name,
                base_branch,
                setup_script,
                origin,
                creator_context,
            } => compact_object(json!({
                "repoRootId": repo_root_id,
                "targetPath": target_path,
                "newBranchName": new_branch_name,
                "baseBranch": base_branch,
                "setupScript": setup_script,
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
                "path": path,
                "origin": origin,
                "creatorContext": creator_context,
            })),
            Self::Worktree {
                target_path,
                origin,
                creator_context,
                ..
            } => compact_object(json!({
                "path": target_path,
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
        match result.current_branch.as_deref() {
            Some(current_branch) => current_branch == new_branch_name,
            None => true,
        }
    }
}

impl AnyHarnessClient {
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
        Ok(None)
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
mod tests {
    use serde_json::json;

    use super::MaterializeWorkspaceRequest;

    #[test]
    fn materialized_result_extracts_existing_path_fields() {
        let request = MaterializeWorkspaceRequest::ExistingPath {
            path: "/workspace/proliferate".to_string(),
            display_name: Some("Proliferate".to_string()),
            origin: None,
            creator_context: None,
        };
        let result = request
            .materialized_result(&json!({
                "repoRoot": { "id": "repo-root-1" },
                "workspace": {
                    "id": "workspace-1",
                    "repoRootId": "repo-root-1",
                    "path": "/workspace/proliferate",
                    "kind": "local",
                    "currentBranch": "main",
                    "displayName": "Proliferate"
                }
            }))
            .expect("result");
        assert_eq!(result.mode, "existing_path");
        assert_eq!(result.anyharness_workspace_id, "workspace-1");
        assert_eq!(result.repo_root_id, "repo-root-1");
        assert_eq!(result.display_name.as_deref(), Some("Proliferate"));
    }

    #[test]
    fn existing_path_body_does_not_pass_display_name_to_anyharness_create_body() {
        let request = MaterializeWorkspaceRequest::ExistingPath {
            path: "/workspace/proliferate".to_string(),
            display_name: Some("Proliferate".to_string()),
            origin: Some(json!({ "kind": "api", "entrypoint": "cloud" })),
            creator_context: Some(json!({ "kind": "human" })),
        };
        assert_eq!(
            request.anyharness_body(),
            json!({
                "path": "/workspace/proliferate",
                "origin": { "kind": "api", "entrypoint": "cloud" },
                "creatorContext": { "kind": "human" }
            })
        );
    }

    #[test]
    fn materialized_result_uses_worktree_repo_root_hint() {
        let request = MaterializeWorkspaceRequest::Worktree {
            repo_root_id: "repo-root-1".to_string(),
            target_path: "/workspace/feature".to_string(),
            new_branch_name: "feature".to_string(),
            base_branch: Some("main".to_string()),
            setup_script: None,
            origin: None,
            creator_context: None,
        };
        let result = request
            .materialized_result(&json!({
                "workspace": {
                    "id": "workspace-2",
                    "path": "/workspace/feature",
                    "kind": "worktree",
                    "currentBranch": "feature",
                    "originalBranch": "main"
                }
            }))
            .expect("result");
        assert_eq!(result.mode, "worktree");
        assert_eq!(result.repo_root_id, "repo-root-1");
    }

    #[test]
    fn worktree_body_uses_anyharness_camel_case_fields() {
        let request = MaterializeWorkspaceRequest::Worktree {
            repo_root_id: "repo-root-1".to_string(),
            target_path: "/workspace/feature".to_string(),
            new_branch_name: "feature".to_string(),
            base_branch: Some("main".to_string()),
            setup_script: Some("pnpm install".to_string()),
            origin: None,
            creator_context: None,
        };
        assert_eq!(
            request.anyharness_body(),
            json!({
                "repoRootId": "repo-root-1",
                "targetPath": "/workspace/feature",
                "newBranchName": "feature",
                "baseBranch": "main",
                "setupScript": "pnpm install"
            })
        );
    }

    #[test]
    fn worktree_recovery_requires_expected_workspace_shape() {
        let request = MaterializeWorkspaceRequest::Worktree {
            repo_root_id: "repo-root-1".to_string(),
            target_path: "/workspace/feature".to_string(),
            new_branch_name: "feature".to_string(),
            base_branch: Some("main".to_string()),
            setup_script: None,
            origin: None,
            creator_context: None,
        };
        assert!(request.recovered_worktree_is_expected(&json!({
            "workspace": {
                "id": "workspace-2",
                "repoRootId": "repo-root-1",
                "path": "/workspace/feature",
                "kind": "worktree",
                "currentBranch": "feature"
            }
        })));
        assert!(!request.recovered_worktree_is_expected(&json!({
            "workspace": {
                "id": "workspace-2",
                "repoRootId": "repo-root-1",
                "path": "/workspace/feature",
                "kind": "worktree",
                "currentBranch": "other"
            }
        })));
        assert!(!request.recovered_worktree_is_expected(&json!({
            "workspace": {
                "id": "workspace-2",
                "repoRootId": "other-root",
                "path": "/workspace/feature",
                "kind": "worktree",
                "currentBranch": "feature"
            }
        })));
    }
}
