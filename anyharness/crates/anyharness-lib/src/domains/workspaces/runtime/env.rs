use std::collections::BTreeMap;
use std::path::Path;

use super::records::path_basename;
use super::WorkspaceRuntime;
use crate::domains::workspaces::env::{
    merge_unprotected_env, read_global_secret_env, read_materialized_session_env,
    read_materialized_workspace_env,
};
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};

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
        let repo_root = self
            .repo_root_service
            .get_repo_root(&workspace.repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {}", workspace.repo_root_id))?;

        let mut env = BTreeMap::new();
        merge_unprotected_env(&mut env, read_global_secret_env(&self.runtime_home)?);
        merge_unprotected_env(
            &mut env,
            read_materialized_workspace_env(Path::new(&workspace.path))?,
        );
        merge_unprotected_env(
            &mut env,
            read_materialized_session_env(Path::new(&workspace.path))?,
        );

        env.insert("PROLIFERATE_WORKSPACE_ID".into(), workspace.id.clone());
        env.insert(
            "PROLIFERATE_WORKSPACE_KIND".into(),
            workspace.kind.as_str().to_string(),
        );
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
            .filter(|branch| branch.as_str() != "HEAD")
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
        if workspace.kind == WorkspaceKind::Worktree {
            env.insert("PROLIFERATE_WORKTREE_DIR".into(), workspace.path.clone());
        }

        Ok(env.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;

    use super::super::test_support::{init_repo, make_runtime, TempDirGuard};
    use crate::persistence::Db;

    #[test]
    fn build_workspace_env_merges_secret_workspace_and_session_files() {
        let source = TempDirGuard::new("workspace-env-source");
        let runtime_home = TempDirGuard::new("workspace-env-home");
        init_repo(source.path());

        fs::create_dir_all(runtime_home.path().join("secrets")).expect("create secrets dir");
        fs::write(
            runtime_home.path().join("secrets/global.env"),
            "GLOBAL_ONLY='global'\nSHARED='global'\nPROLIFERATE_WORKSPACE_ID='spoofed'\n",
        )
        .expect("write global env");

        let workspace_env_dir = source.path().join(".proliferate/env");
        fs::create_dir_all(&workspace_env_dir).expect("create workspace env dir");
        fs::write(
            workspace_env_dir.join("workspace.env"),
            "WORKSPACE_ONLY='workspace'\nSHARED='workspace'\n",
        )
        .expect("write workspace env");
        fs::write(
            workspace_env_dir.join("session.env"),
            "SESSION_ONLY='session'\nSHARED='session'\nPROLIFERATE_REPO_DIR='spoofed'\n",
        )
        .expect("write session env");

        let db = Db::open_in_memory().expect("open db");
        let runtime = make_runtime(&db, runtime_home.path());
        let resolution = runtime
            .create_workspace(&source.path().display().to_string())
            .expect("create workspace");

        let env = runtime
            .build_workspace_env(&resolution.workspace, Some("origin/main"))
            .expect("build workspace env")
            .into_iter()
            .collect::<BTreeMap<_, _>>();

        assert_eq!(env.get("GLOBAL_ONLY").map(String::as_str), Some("global"));
        assert_eq!(
            env.get("WORKSPACE_ONLY").map(String::as_str),
            Some("workspace")
        );
        assert_eq!(env.get("SESSION_ONLY").map(String::as_str), Some("session"));
        assert_eq!(env.get("SHARED").map(String::as_str), Some("session"));
        assert_eq!(
            env.get("PROLIFERATE_WORKSPACE_ID").map(String::as_str),
            Some(resolution.workspace.id.as_str())
        );
        assert_eq!(
            env.get("PROLIFERATE_REPO_DIR").map(String::as_str),
            Some(resolution.repo_root.path.as_str())
        );
        assert_eq!(
            env.get("PROLIFERATE_BASE_REF").map(String::as_str),
            Some("origin/main")
        );
    }
}
