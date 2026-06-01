use std::collections::BTreeMap;
use std::path::Path;

use super::records::path_basename;
use super::WorkspaceRuntime;
use crate::domains::workspaces::env::read_materialized_session_env;
use crate::domains::workspaces::model::WorkspaceRecord;

impl WorkspaceRuntime {
    pub fn workspace_env(
        &self,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<BTreeMap<String, String>> {
        Ok(self
            .build_workspace_env(workspace, None)?
            .into_iter()
            .collect())
    }

    pub fn build_workspace_env(
        &self,
        workspace: &WorkspaceRecord,
        base_ref: Option<&str>,
    ) -> anyhow::Result<Vec<(String, String)>> {
        let repo_root_id = workspace
            .repo_root_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("workspace missing repo_root_id: {}", workspace.id))?;
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let mut env = BTreeMap::new();
        env.insert("PROLIFERATE_WORKSPACE_ID".into(), workspace.id.clone());
        env.insert("PROLIFERATE_WORKSPACE_KIND".into(), workspace.kind.clone());
        env.insert("PROLIFERATE_WORKSPACE_DIR".into(), workspace.path.clone());
        env.insert("PROLIFERATE_REPO_ROOT_ID".into(), repo_root.id.clone());
        env.insert("PROLIFERATE_REPO_DIR".into(), repo_root.path.clone());
        env.insert(
            "PROLIFERATE_RUNTIME_HOME".into(),
            self.runtime_home.display().to_string(),
        );
        let repo_name = repo_root
            .remote_repo_name
            .clone()
            .unwrap_or_else(|| path_basename(&repo_root.path));
        env.insert("PROLIFERATE_REPO_NAME".into(), repo_name);
        if let Some(branch) = workspace
            .current_branch
            .as_ref()
            .or(workspace.original_branch.as_ref())
        {
            env.insert("PROLIFERATE_BRANCH".into(), branch.clone());
        }
        if let Some(base_ref) = base_ref {
            env.insert("PROLIFERATE_BASE_REF".into(), base_ref.to_string());
        }
        if let Some(provider) = &repo_root.remote_provider {
            env.insert("PROLIFERATE_GIT_PROVIDER".into(), provider.clone());
        }
        if let Some(owner) = &repo_root.remote_owner {
            env.insert("PROLIFERATE_GIT_OWNER".into(), owner.clone());
        }
        if let Some(repo) = &repo_root.remote_repo_name {
            env.insert("PROLIFERATE_GIT_REPO".into(), repo.clone());
        }
        if workspace.kind == "worktree" {
            env.insert("PROLIFERATE_WORKTREE_DIR".into(), workspace.path.clone());
        }
        env.extend(read_materialized_session_env(Path::new(&workspace.path))?);

        Ok(env.into_iter().collect())
    }
}
