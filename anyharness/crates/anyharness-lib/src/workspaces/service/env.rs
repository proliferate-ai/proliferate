use std::collections::BTreeMap;

use super::records::path_basename;
use super::WorkspaceService;
use crate::workspaces::model::WorkspaceRecord;

impl WorkspaceService {
    pub fn workspace_env(&self, workspace: &WorkspaceRecord) -> BTreeMap<String, String> {
        self.build_workspace_env(workspace, None)
            .into_iter()
            .collect()
    }

    pub fn build_workspace_env(
        &self,
        workspace: &WorkspaceRecord,
        base_ref: Option<&str>,
    ) -> Vec<(String, String)> {
        let mut env = BTreeMap::new();
        env.insert("PROLIFERATE_WORKSPACE_ID".into(), workspace.id.clone());
        env.insert("PROLIFERATE_WORKSPACE_KIND".into(), workspace.kind.clone());
        env.insert("PROLIFERATE_WORKSPACE_DIR".into(), workspace.path.clone());
        env.insert(
            "PROLIFERATE_REPO_DIR".into(),
            workspace.source_repo_root_path.clone(),
        );
        env.insert(
            "PROLIFERATE_RUNTIME_HOME".into(),
            self.runtime_home.display().to_string(),
        );
        let repo_name = workspace
            .git_repo_name
            .clone()
            .unwrap_or_else(|| path_basename(&workspace.source_repo_root_path));
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
        if let Some(source_workspace_id) = &workspace.source_workspace_id {
            env.insert(
                "PROLIFERATE_SOURCE_WORKSPACE_ID".into(),
                source_workspace_id.clone(),
            );
        }
        if let Some(provider) = &workspace.git_provider {
            env.insert("PROLIFERATE_GIT_PROVIDER".into(), provider.clone());
        }
        if let Some(owner) = &workspace.git_owner {
            env.insert("PROLIFERATE_GIT_OWNER".into(), owner.clone());
        }
        if let Some(repo) = &workspace.git_repo_name {
            env.insert("PROLIFERATE_GIT_REPO".into(), repo.clone());
        }
        if workspace.kind == "worktree" {
            env.insert("PROLIFERATE_WORKTREE_DIR".into(), workspace.path.clone());
        }
        env.into_iter().collect()
    }
}
