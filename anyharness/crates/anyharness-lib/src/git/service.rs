use std::path::{Path, PathBuf};
use std::time::Duration;

use super::default_branch::detect_default_branch;
use super::diff;
use super::executor::{
    resolve_git_repo_root, run_git, run_git_ok, run_git_with_timeout, TimedGitOutput,
};
use super::parse_status::parse_porcelain_v2;
use super::types::{
    CommitError, GitActionAvailability, GitBranch, GitBranchDiffFilesResult, GitChangedFile,
    GitDiffError, GitDiffResult, GitDiffScope, GitFileStatus, GitIncludedState, GitOperation,
    GitStatusSnapshot, GitStatusSummary, PushError,
};

pub struct GitService;

impl GitService {
    pub fn resolve_repo_root(workspace_path: &Path) -> anyhow::Result<PathBuf> {
        resolve_git_repo_root(workspace_path)
    }

    pub fn status(workspace_id: &str, workspace_path: &Path) -> anyhow::Result<GitStatusSnapshot> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        let raw = run_git_ok(
            &repo_root_path,
            &["status", "--porcelain=v2", "--branch", "-z"],
        )?;

        let mut parsed = parse_porcelain_v2(&raw);

        parsed.operation = detect_operation(&repo_root_path);

        enrich_file_stats(&repo_root_path, &mut parsed.files);

        let detached = parsed.branch_head.is_none();

        let included_files = parsed
            .files
            .iter()
            .filter(|f| f.included_state != GitIncludedState::Excluded)
            .count() as u32;

        let conflicted_files = parsed
            .files
            .iter()
            .filter(|f| f.status == GitFileStatus::Conflicted)
            .count() as u32;

        let total_additions: u32 = parsed.files.iter().map(|f| f.additions).sum();
        let total_deletions: u32 = parsed.files.iter().map(|f| f.deletions).sum();
        let changed_files = parsed.files.len() as u32;
        let clean = changed_files == 0;

        let can_commit = changed_files > 0 && conflicted_files == 0;
        let has_upstream = parsed.upstream.is_some();
        let can_push = !detached && (parsed.ahead > 0 || !has_upstream) && clean;
        let push_label = if has_upstream {
            "Push"
        } else {
            "Publish branch"
        }
        .to_string();
        let can_create_pr = !detached && has_upstream && parsed.ahead == 0 && clean;

        let suggested_base = detect_default_branch(&repo_root_path);

        Ok(GitStatusSnapshot {
            workspace_id: workspace_id.to_string(),
            workspace_path: workspace_path.display().to_string(),
            repo_root_path: repo_root,
            current_branch: parsed.branch_head,
            head_oid: parsed.branch_oid,
            detached,
            upstream_branch: parsed.upstream,
            suggested_base_branch: suggested_base,
            ahead: parsed.ahead,
            behind: parsed.behind,
            operation: parsed.operation,
            conflicted: conflicted_files > 0,
            clean,
            summary: GitStatusSummary {
                changed_files,
                additions: total_additions,
                deletions: total_deletions,
                included_files,
                conflicted_files,
            },
            actions: GitActionAvailability {
                can_commit,
                can_push,
                push_label,
                can_create_pull_request: can_create_pr,
                can_create_draft_pull_request: can_create_pr,
                can_create_branch_workspace: true,
                reason_if_blocked: if conflicted_files > 0 {
                    Some("Conflicts must be resolved first".into())
                } else {
                    None
                },
            },
            files: parsed.files,
        })
    }

    pub fn diff_for_path(workspace_path: &Path, file_path: &str) -> anyhow::Result<GitDiffResult> {
        Self::diff_for_path_with_scope(
            workspace_path,
            file_path,
            GitDiffScope::WorkingTree,
            None,
            None,
        )
        .map_err(anyhow::Error::from)
    }

    pub fn diff_for_path_with_scope(
        workspace_path: &Path,
        file_path: &str,
        scope: GitDiffScope,
        base_ref: Option<&str>,
        old_path: Option<&str>,
    ) -> Result<GitDiffResult, GitDiffError> {
        diff::diff_for_path_with_scope(workspace_path, file_path, scope, base_ref, old_path)
    }

    pub fn branch_diff_files(
        workspace_path: &Path,
        base_ref: Option<&str>,
    ) -> Result<GitBranchDiffFilesResult, GitDiffError> {
        diff::branch_diff_files(workspace_path, base_ref)
    }

    pub fn list_branches(workspace_path: &Path) -> anyhow::Result<Vec<GitBranch>> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        let raw = run_git_ok(
            &repo_root_path,
            &[
                "for-each-ref",
                "--format=%(refname:short)\t%(objecttype)\t%(HEAD)\t%(upstream:short)",
                "refs/heads/",
                "refs/remotes/",
            ],
        )?;

        let default_branch = detect_default_branch(&repo_root_path);
        let mut branches = Vec::new();

        for line in raw.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                continue;
            }
            let name = parts[0].to_string();
            let is_head = parts[2] == "*";
            let upstream = parts.get(3).and_then(|s| {
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                }
            });
            let is_remote = name.contains('/');
            let is_default = default_branch.as_deref() == Some(&name);

            branches.push(GitBranch {
                name,
                is_remote,
                is_head,
                is_default,
                upstream,
            });
        }

        Ok(branches)
    }

    pub fn head_is_ancestor_of(workspace_path: &Path, base_ref: &str) -> anyhow::Result<bool> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);
        let output = std::process::Command::new("git")
            .args(["merge-base", "--is-ancestor", "HEAD", base_ref])
            .current_dir(&repo_root_path)
            .output()?;
        if output.status.success() {
            return Ok(true);
        }
        if output.status.code() == Some(1) {
            return Ok(false);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("{}", git_command_message(&stderr, "merge-base failed"))
    }

    pub fn resolve_ref_oid(workspace_path: &Path, ref_name: &str) -> anyhow::Result<String> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);
        Ok(
            run_git_ok(&repo_root_path, &["rev-parse", "--verify", ref_name])?
                .trim()
                .to_string(),
        )
    }

    pub fn rename_branch(
        workspace_path: &Path,
        new_name: &str,
    ) -> anyhow::Result<(String, String)> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        let old_name = run_git_ok(&repo_root_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();

        if old_name == "HEAD" {
            anyhow::bail!("cannot rename a detached HEAD");
        }

        run_git_ok(&repo_root_path, &["branch", "-m", new_name])?;

        Ok((old_name, new_name.to_string()))
    }

    pub fn stage_paths(workspace_path: &Path, paths: &[String]) -> anyhow::Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);
        let mut args = vec!["add", "--"];
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(path_refs);
        run_git_ok(&repo_root_path, &args)?;
        Ok(())
    }

    pub fn unstage_paths(workspace_path: &Path, paths: &[String]) -> anyhow::Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);
        let mut args = vec!["reset", "HEAD", "--"];
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(path_refs);
        run_git_ok(&repo_root_path, &args)?;
        Ok(())
    }

    pub fn commit_staged(
        workspace_path: &Path,
        summary: &str,
        body: Option<&str>,
    ) -> Result<(String, String), CommitError> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        let staged_check = run_git_ok(&repo_root_path, &["diff", "--cached", "--stat"])?;
        if staged_check.trim().is_empty() {
            return Err(CommitError::NothingStaged);
        }

        let mut msg = summary.to_string();
        if let Some(b) = body {
            if !b.is_empty() {
                msg.push_str("\n\n");
                msg.push_str(b);
            }
        }

        let commit = run_git(&repo_root_path, &["commit", "-m", &msg])?;
        if !commit.success {
            return Err(CommitError::Failed {
                message: git_command_message(&commit.stderr, "commit failed"),
            });
        }
        let oid = run_git_ok(&repo_root_path, &["rev-parse", "HEAD"])?
            .trim()
            .to_string();

        Ok((oid, summary.to_string()))
    }

    pub fn push_current_branch(
        workspace_path: &Path,
        remote: Option<&str>,
    ) -> Result<(String, String, bool), PushError> {
        Self::push_current_branch_inner(workspace_path, remote, None)
    }

    pub fn push_current_branch_with_timeout(
        workspace_path: &Path,
        remote: Option<&str>,
        timeout: Duration,
    ) -> Result<(String, String, bool), PushError> {
        Self::push_current_branch_inner(workspace_path, remote, Some(timeout))
    }

    fn push_current_branch_inner(
        workspace_path: &Path,
        remote: Option<&str>,
        timeout: Option<Duration>,
    ) -> Result<(String, String, bool), PushError> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        let branch = run_git_ok(&repo_root_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();

        if branch == "HEAD" {
            return Err(PushError::DetachedHead);
        }

        let upstream = run_git(
            &repo_root_path,
            &[
                "rev-parse",
                "--abbrev-ref",
                &format!("{branch}@{{upstream}}"),
            ],
        )?;

        let remote_name = remote.unwrap_or("origin");

        let push_args: Vec<&str> = if upstream.success {
            vec!["push", remote_name, &branch]
        } else {
            vec!["push", "-u", remote_name, &branch]
        };
        let push = if let Some(timeout) = timeout {
            match run_git_with_timeout(&repo_root_path, &push_args, timeout)? {
                TimedGitOutput::Completed(output) => output,
                TimedGitOutput::TimedOut => {
                    return Err(PushError::Failed {
                        message: format!("push timed out after {}s", timeout.as_secs()),
                    });
                }
            }
        } else {
            run_git(&repo_root_path, &push_args)?
        };

        if !push.success {
            let message = git_command_message(&push.stderr, "push failed");
            if push.stderr.to_ascii_lowercase().contains("rejected") {
                return Err(PushError::Rejected { message });
            }
            return Err(PushError::Failed { message });
        }

        let published = if upstream.success { false } else { true };

        Ok((remote_name.to_string(), branch, published))
    }

    pub fn autosave_cowork_workspace(
        workspace_path: &Path,
        summary: &str,
    ) -> anyhow::Result<Option<String>> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        let unstaged = run_git(&repo_root_path, &["diff", "--quiet"])?;
        let staged = run_git(&repo_root_path, &["diff", "--cached", "--quiet"])?;
        if unstaged.success && staged.success {
            return Ok(None);
        }

        run_git_ok(&repo_root_path, &["add", "-A"])?;
        let staged_check = run_git_ok(&repo_root_path, &["diff", "--cached", "--stat"])?;
        if staged_check.trim().is_empty() {
            return Ok(None);
        }

        let (oid, _) =
            Self::commit_staged(&repo_root_path, summary, None).map_err(anyhow::Error::from)?;
        Ok(Some(oid))
    }
}

fn detect_operation(repo_root: &Path) -> GitOperation {
    let git_dir = repo_root.join(".git");
    let git_path = if git_dir.is_dir() {
        git_dir
    } else if git_dir.is_file() {
        if let Ok(content) = std::fs::read_to_string(&git_dir) {
            if let Some(rest) = content.strip_prefix("gitdir: ") {
                PathBuf::from(rest.trim())
            } else {
                return GitOperation::None;
            }
        } else {
            return GitOperation::None;
        }
    } else {
        return GitOperation::None;
    };

    if git_path.join("MERGE_HEAD").exists() {
        GitOperation::Merge
    } else if git_path.join("rebase-merge").exists() || git_path.join("rebase-apply").exists() {
        GitOperation::Rebase
    } else if git_path.join("CHERRY_PICK_HEAD").exists() {
        GitOperation::CherryPick
    } else if git_path.join("REVERT_HEAD").exists() {
        GitOperation::Revert
    } else {
        GitOperation::None
    }
}

fn enrich_file_stats(repo_root: &Path, files: &mut [GitChangedFile]) {
    let numstat = run_git(repo_root, &["diff", "--numstat", "-z"]);
    let staged_numstat = run_git(repo_root, &["diff", "--cached", "--numstat", "-z"]);

    fn apply_numstats(raw: &str, files: &mut [GitChangedFile]) {
        for chunk in raw.split('\0') {
            let chunk = chunk.trim();
            if chunk.is_empty() {
                continue;
            }
            let parts: Vec<&str> = chunk.splitn(3, '\t').collect();
            if parts.len() < 3 {
                continue;
            }
            let add: u32 = parts[0].parse().unwrap_or(0);
            let del: u32 = parts[1].parse().unwrap_or(0);
            let path = parts[2];
            if let Some(f) = files.iter_mut().find(|f| f.path == path) {
                f.additions = f.additions.saturating_add(add);
                f.deletions = f.deletions.saturating_add(del);
                if parts[0] == "-" && parts[1] == "-" {
                    f.binary = true;
                }
            }
        }
    }

    if let Ok(o) = numstat {
        if o.success {
            apply_numstats(&o.stdout, files);
        }
    }
    if let Ok(o) = staged_numstat {
        if o.success {
            apply_numstats(&o.stdout, files);
        }
    }
}

fn git_command_message(stderr: &str, fallback: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}
