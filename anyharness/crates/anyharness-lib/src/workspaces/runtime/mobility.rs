use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use super::records::build_workspace_record;
use super::WorkspaceRuntime;
use crate::adapters::git::GitService;
use crate::origin::OriginContext;
use crate::repo_roots::model::RepoRootRecord;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::resolver;
use crate::workspaces::types::PreparedWorkspaceMobilityDestination;

impl WorkspaceRuntime {
    pub fn create_mobility_destination(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> anyhow::Result<PreparedWorkspaceMobilityDestination> {
        let requested_branch = requested_branch.trim();
        let requested_base_sha = requested_base_sha.trim();
        if requested_branch.is_empty() {
            anyhow::bail!("requested branch is required");
        }
        if requested_base_sha.is_empty() {
            anyhow::bail!("requested base sha is required");
        }

        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)?
            .ok_or_else(|| anyhow::anyhow!("repo root not found: {repo_root_id}"))?;

        let base_dir = self
            .runtime_home
            .join("mobility")
            .join("destinations")
            .join(&repo_root.id);
        fs::create_dir_all(&base_dir)?;

        let target_path = if let Some(destination_id) = destination_id {
            validate_mobility_destination_id(destination_id)?;
            let candidate = base_dir.join(destination_id);
            let candidate_string = candidate.to_string_lossy().to_string();
            // Mobility destinations are managed worktree paths and must not
            // collide with any active workspace row, regardless of kind.
            if let Some(existing) = self.store.find_active_by_path(&candidate_string)? {
                if existing.current_branch.as_deref() == Some(requested_branch) {
                    self.validate_reusable_mobility_destination_workspace(
                        &existing,
                        requested_branch,
                        requested_base_sha,
                    )?;
                    return Ok(PreparedWorkspaceMobilityDestination {
                        workspace: existing,
                        created: false,
                    });
                }
                anyhow::bail!(
                    "mobility destination conflict: destination id already belongs to branch {}",
                    existing.current_branch.as_deref().unwrap_or("<unknown>")
                );
            }
            if candidate.exists() {
                let workspace = self.adopt_existing_mobility_destination(
                    &repo_root,
                    &candidate,
                    requested_branch,
                    requested_base_sha,
                )?;
                return Ok(PreparedWorkspaceMobilityDestination {
                    workspace,
                    created: true,
                });
            }
            candidate
        } else {
            if let Some(existing) = self.find_reusable_mobility_destination_workspace(
                &repo_root.id,
                requested_branch,
                requested_base_sha,
            )? {
                return Ok(PreparedWorkspaceMobilityDestination {
                    workspace: existing,
                    created: false,
                });
            }

            let mut slug = sanitize_mobility_destination_name(
                preferred_workspace_name.unwrap_or(requested_branch),
            );
            if slug.is_empty() {
                slug = "workspace".to_string();
            }
            let short_sha = requested_base_sha.chars().take(8).collect::<String>();

            (0..100)
                .map(|attempt| {
                    let suffix = if attempt == 0 {
                        String::new()
                    } else {
                        format!("-{}", attempt + 1)
                    };
                    base_dir.join(format!("{slug}-{short_sha}{suffix}"))
                })
                .find(|candidate| {
                    let candidate_string = candidate.to_string_lossy();
                    !candidate.exists()
                        // Mobility destinations are managed worktree paths and
                        // remain unique across all active workspace kinds.
                        && self
                            .store
                            .find_active_by_path(&candidate_string)
                            .ok()
                            .flatten()
                            .is_none()
                })
                .ok_or_else(|| anyhow::anyhow!("unable to allocate a mobility destination path"))?
        };

        let target_path_string = target_path.display().to_string();
        let branch_existed_before_create = GitService::ref_exists(
            Path::new(&repo_root.path),
            &format!("refs/heads/{requested_branch}"),
        );

        GitService::create_worktree_at_ref(
            &repo_root.path,
            &target_path_string,
            requested_branch,
            requested_base_sha,
        )?;

        let ctx = resolver::resolve_git_context(&target_path_string)?;
        if !branch_existed_before_create {
            publish_created_branch_if_possible(
                &ctx.repo_root,
                requested_branch,
                ctx.remote_url.as_deref(),
            );
        }
        let record = build_workspace_record(
            &repo_root,
            &ctx.repo_root,
            "worktree",
            "standard",
            ctx.current_branch.clone(),
            OriginContext::system_local_runtime(),
            None,
        );
        self.store.insert(&record)?;

        Ok(PreparedWorkspaceMobilityDestination {
            workspace: record,
            created: true,
        })
    }

    fn validate_reusable_mobility_destination_workspace(
        &self,
        workspace: &WorkspaceRecord,
        requested_branch: &str,
        requested_base_sha: &str,
    ) -> anyhow::Result<()> {
        if workspace.kind != "worktree"
            || workspace.surface != "standard"
            || workspace.current_branch.as_deref() != Some(requested_branch)
        {
            anyhow::bail!(
                "mobility destination conflict: destination workspace is not a reusable worktree"
            );
        }

        let ctx = resolver::resolve_git_context(&workspace.path)?;
        if !ctx.is_worktree || ctx.current_branch.as_deref() != Some(requested_branch) {
            anyhow::bail!(
                "mobility destination conflict: destination workspace is not on requested branch {requested_branch}"
            );
        }
        let workspace_path = Path::new(&ctx.repo_root);
        let actual_head = GitService::stdout_result(workspace_path, &["rev-parse", "HEAD"])?;
        let requested_head = GitService::stdout_result(
            workspace_path,
            &[
                "rev-parse",
                "--verify",
                &format!("{requested_base_sha}^{{commit}}"),
            ],
        )?;
        if actual_head != requested_head {
            anyhow::bail!(
                "mobility destination conflict: destination workspace is at {actual_head}, not requested commit {requested_head}"
            );
        }
        let status = GitService::stdout_result(
            workspace_path,
            &["status", "--porcelain", "--untracked-files=all"],
        )?;
        if !status.trim().is_empty() {
            anyhow::bail!(
                "mobility destination conflict: destination workspace has uncommitted changes"
            );
        }
        Ok(())
    }

    fn find_reusable_mobility_destination_workspace(
        &self,
        repo_root_id: &str,
        requested_branch: &str,
        requested_base_sha: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        let requested_head = format!("{requested_base_sha}^{{commit}}");
        let base_dir = self
            .runtime_home
            .join("mobility")
            .join("destinations")
            .join(repo_root_id);
        let canonical_base_dir = fs::canonicalize(&base_dir).unwrap_or(base_dir);
        for workspace in self.store.list_active_by_repo_root_id(repo_root_id)? {
            if workspace.kind != "worktree"
                || workspace.surface != "standard"
                || workspace.current_branch.as_deref() != Some(requested_branch)
                || !Path::new(&workspace.path).exists()
                || !Path::new(&workspace.path).starts_with(&canonical_base_dir)
            {
                continue;
            }

            let ctx = match resolver::resolve_git_context(&workspace.path) {
                Ok(ctx) => ctx,
                Err(_) => continue,
            };
            if !ctx.is_worktree || ctx.current_branch.as_deref() != Some(requested_branch) {
                continue;
            }

            let workspace_path = Path::new(&ctx.repo_root);
            let actual_head = GitService::stdout_result(workspace_path, &["rev-parse", "HEAD"])?;
            let requested_head = GitService::stdout_result(
                workspace_path,
                &["rev-parse", "--verify", &requested_head],
            )?;
            if actual_head != requested_head {
                continue;
            }

            let status = GitService::stdout_result(
                workspace_path,
                &["status", "--porcelain", "--untracked-files=all"],
            )?;
            if !status.trim().is_empty() {
                anyhow::bail!(
                    "mobility destination conflict: existing branch {requested_branch} has uncommitted changes in {}",
                    workspace.path
                );
            }

            return Ok(Some(workspace));
        }

        Ok(None)
    }

    fn adopt_existing_mobility_destination(
        &self,
        repo_root: &RepoRootRecord,
        target_path: &Path,
        requested_branch: &str,
        requested_base_sha: &str,
    ) -> anyhow::Result<WorkspaceRecord> {
        let target_path_string = target_path.display().to_string();

        if let Some(retired) = self
            .store
            .find_retired_incomplete_cleanup_by_path_and_kind(&target_path_string, "worktree")?
        {
            anyhow::bail!(
                "mobility destination conflict: destination path has pending cleanup from retired workspace {}",
                retired.id
            );
        }

        let ctx = resolver::resolve_git_context(&target_path_string).map_err(|error| {
            anyhow::anyhow!(
                "mobility destination conflict: destination path already exists but is not a usable git worktree: {error}"
            )
        })?;
        if !ctx.is_worktree {
            anyhow::bail!(
                "mobility destination conflict: destination path already exists but is not a git worktree"
            );
        }
        if ctx.current_branch.as_deref() != Some(requested_branch) {
            anyhow::bail!(
                "mobility destination conflict: destination path already exists for branch {}",
                ctx.current_branch.as_deref().unwrap_or("<unknown>")
            );
        }

        let actual_head =
            GitService::stdout_result(Path::new(&ctx.repo_root), &["rev-parse", "HEAD"])?;
        let requested_head = GitService::stdout_result(
            Path::new(&ctx.repo_root),
            &[
                "rev-parse",
                "--verify",
                &format!("{requested_base_sha}^{{commit}}"),
            ],
        )?;
        if actual_head != requested_head {
            anyhow::bail!(
                "mobility destination conflict: destination path is at {actual_head}, not requested commit {requested_head}"
            );
        }

        let status = GitService::stdout_result(
            Path::new(&ctx.repo_root),
            &["status", "--porcelain", "--untracked-files=all"],
        )?;
        if !status.trim().is_empty() {
            anyhow::bail!(
                "mobility destination conflict: destination path already exists with uncommitted changes"
            );
        }

        let record = build_workspace_record(
            repo_root,
            &ctx.repo_root,
            "worktree",
            "standard",
            ctx.current_branch.clone(),
            OriginContext::system_local_runtime(),
            None,
        );
        self.store.insert(&record)?;

        Ok(record)
    }
}

fn sanitize_mobility_destination_name(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' => ch.to_ascii_lowercase(),
            '-' | '_' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn validate_mobility_destination_id(value: &str) -> anyhow::Result<()> {
    if value.is_empty() || value.len() > 96 {
        anyhow::bail!("invalid destination id");
    }
    if value == "." || value == ".." || value.contains('/') || value.contains('\\') {
        anyhow::bail!("invalid destination id");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        anyhow::bail!("invalid destination id");
    }
    Ok(())
}

fn publish_created_branch_if_possible(
    workspace_path: &str,
    branch_name: &str,
    remote_url: Option<&str>,
) {
    if remote_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        tracing::info!(
            workspace_path = %workspace_path,
            branch_name = %branch_name,
            "[workspace-latency] workspace.worktree.branch_publish.skipped_no_origin"
        );
        return;
    }

    let started = Instant::now();
    tracing::info!(
        workspace_path = %workspace_path,
        branch_name = %branch_name,
        "[workspace-latency] workspace.worktree.branch_publish.start"
    );

    match GitService::push_current_branch_with_timeout(
        Path::new(workspace_path),
        Some("origin"),
        Duration::from_secs(20),
    ) {
        Ok((remote, pushed_branch, published)) => {
            tracing::info!(
                workspace_path = %workspace_path,
                requested_branch = %branch_name,
                pushed_branch = %pushed_branch,
                remote = %remote,
                published,
                elapsed_ms = started.elapsed().as_millis(),
                "[workspace-latency] workspace.worktree.branch_publish.success"
            );
        }
        Err(error) => {
            tracing::info!(
                workspace_path = %workspace_path,
                branch_name = %branch_name,
                elapsed_ms = started.elapsed().as_millis(),
                error = %error,
                "[workspace-latency] workspace.worktree.branch_publish.skipped"
            );
        }
    }
}
