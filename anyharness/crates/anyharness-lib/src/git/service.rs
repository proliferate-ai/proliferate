use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::executor::{
    resolve_git_repo_root, run_git, run_git_ok, run_git_with_timeout, GitOutput, TimedGitOutput,
};
use super::parse_status::parse_porcelain_v2;
use super::types::{
    CommitError, GitActionAvailability, GitBranch, GitBranchDiffFilesResult, GitChangedFile,
    GitDiffError, GitDiffFile, GitDiffResult, GitDiffScope, GitFileStatus, GitIncludedState,
    GitOperation, GitStatusSnapshot, GitStatusSummary, PushError,
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
        if file_path.trim().is_empty() {
            return Err(GitDiffError::GitFailed {
                message: "diff path is required".to_string(),
            });
        }
        if scope != GitDiffScope::Branch && (base_ref.is_some() || old_path.is_some()) {
            return Err(GitDiffError::InvalidBaseRef);
        }

        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);

        match scope {
            GitDiffScope::WorkingTree => {
                let loaded = load_working_tree_diff(&repo_root_path, file_path)?;
                Ok(diff_result(
                    file_path,
                    GitDiffScope::WorkingTree,
                    loaded,
                    None,
                ))
            }
            GitDiffScope::Unstaged => {
                let loaded = load_simple_diff(&repo_root_path, &["diff"], file_path)?;
                Ok(diff_result(file_path, GitDiffScope::Unstaged, loaded, None))
            }
            GitDiffScope::Staged => {
                let loaded = load_simple_diff(&repo_root_path, &["diff", "--cached"], file_path)?;
                Ok(diff_result(file_path, GitDiffScope::Staged, loaded, None))
            }
            GitDiffScope::Branch => {
                let base = resolve_branch_diff_base(&repo_root_path, base_ref)?;
                let loaded = load_branch_path_diff(&repo_root_path, &base, file_path, old_path)?;
                Ok(diff_result(
                    file_path,
                    GitDiffScope::Branch,
                    loaded,
                    Some(base),
                ))
            }
        }
    }

    pub fn branch_diff_files(
        workspace_path: &Path,
        base_ref: Option<&str>,
    ) -> Result<GitBranchDiffFilesResult, GitDiffError> {
        let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let repo_root_path = PathBuf::from(&repo_root);
        let base = resolve_branch_diff_base(&repo_root_path, base_ref)?;

        let name_status = run_git_checked(
            &repo_root_path,
            &[
                "diff".to_string(),
                "--name-status".to_string(),
                "-z".to_string(),
                "--find-renames".to_string(),
                "--find-copies".to_string(),
                base.merge_base_oid.clone(),
                "HEAD".to_string(),
                "--".to_string(),
            ],
        )?;
        let numstat = run_git_checked(
            &repo_root_path,
            &[
                "diff".to_string(),
                "--numstat".to_string(),
                "-z".to_string(),
                "--find-renames".to_string(),
                "--find-copies".to_string(),
                base.merge_base_oid.clone(),
                "HEAD".to_string(),
                "--".to_string(),
            ],
        )?;

        let stats = parse_numstat_z_map(&numstat.stdout);
        let mut files = parse_name_status_z(&name_status.stdout)
            .into_iter()
            .map(|mut file| {
                if let Some(stat) = stats.get(&(file.old_path.clone(), file.path.clone())) {
                    file.additions = stat.additions;
                    file.deletions = stat.deletions;
                    file.binary = stat.binary;
                }
                file
            })
            .collect::<Vec<_>>();
        files.sort_by(|a, b| {
            a.path
                .cmp(&b.path)
                .then_with(|| a.old_path.cmp(&b.old_path))
        });

        Ok(GitBranchDiffFilesResult {
            base_ref: base.base_ref,
            resolved_base_oid: base.resolved_base_oid,
            merge_base_oid: base.merge_base_oid,
            head_oid: base.head_oid,
            files,
        })
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

#[derive(Debug, Clone, Copy, Default)]
struct DiffStats {
    additions: u32,
    deletions: u32,
    binary: bool,
}

#[derive(Debug, Clone)]
struct LoadedDiff {
    patch: Option<String>,
    stats: DiffStats,
}

#[derive(Debug, Clone)]
struct BranchDiffBase {
    base_ref: String,
    resolved_base_oid: String,
    merge_base_oid: String,
    head_oid: String,
}

const MAX_DIFF_PATCH_BYTES: usize = 500_000;

fn load_working_tree_diff(repo_root: &Path, file_path: &str) -> Result<LoadedDiff, GitDiffError> {
    let unstaged = load_simple_diff(repo_root, &["diff"], file_path)?;
    if unstaged.patch.is_some() {
        return Ok(unstaged);
    }

    let staged = load_simple_diff(repo_root, &["diff", "--cached"], file_path)?;
    if staged.patch.is_some() {
        return Ok(staged);
    }

    Ok(LoadedDiff {
        patch: None,
        stats: DiffStats::default(),
    })
}

fn load_simple_diff(
    repo_root: &Path,
    diff_prefix: &[&str],
    file_path: &str,
) -> Result<LoadedDiff, GitDiffError> {
    let mut patch_args = diff_prefix
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    patch_args.push("--".to_string());
    patch_args.push(file_path.to_string());
    let patch = run_git_checked(repo_root, &patch_args)?;

    let mut numstat_args = diff_prefix
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    numstat_args.push("--numstat".to_string());
    numstat_args.push("--".to_string());
    numstat_args.push(file_path.to_string());
    let numstat = run_git_checked(repo_root, &numstat_args)?;

    Ok(LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats: parse_numstat_summary(&numstat.stdout),
    })
}

fn load_branch_path_diff(
    repo_root: &Path,
    base: &BranchDiffBase,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<LoadedDiff, GitDiffError> {
    let mut patch_args = branch_diff_base_args(&base.merge_base_oid);
    patch_args.push("--".to_string());
    patch_args.push(file_path.to_string());
    if let Some(old_path) = old_path {
        if !old_path.trim().is_empty() && old_path != file_path {
            patch_args.push(old_path.to_string());
        }
    }
    let patch = run_git_checked(repo_root, &patch_args)?;

    let mut numstat_args = vec![
        "diff".to_string(),
        "--numstat".to_string(),
        "-z".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        base.merge_base_oid.clone(),
        "HEAD".to_string(),
        "--".to_string(),
        file_path.to_string(),
    ];
    if let Some(old_path) = old_path {
        if !old_path.trim().is_empty() && old_path != file_path {
            numstat_args.push(old_path.to_string());
        }
    }
    let numstat = run_git_checked(repo_root, &numstat_args)?;

    Ok(LoadedDiff {
        patch: normalize_patch(patch.stdout),
        stats: parse_numstat_z_map(&numstat.stdout)
            .values()
            .copied()
            .fold(DiffStats::default(), combine_stats),
    })
}

fn branch_diff_base_args(merge_base_oid: &str) -> Vec<String> {
    vec![
        "diff".to_string(),
        "--find-renames".to_string(),
        "--find-copies".to_string(),
        merge_base_oid.to_string(),
        "HEAD".to_string(),
    ]
}

fn diff_result(
    path: &str,
    scope: GitDiffScope,
    loaded: LoadedDiff,
    base: Option<BranchDiffBase>,
) -> GitDiffResult {
    let (patch, truncated) = match loaded.patch {
        Some(patch) => {
            let truncated = patch.len() > MAX_DIFF_PATCH_BYTES;
            (Some(truncate_patch(patch)), truncated)
        }
        None => (None, false),
    };

    GitDiffResult {
        path: path.to_string(),
        scope,
        binary: loaded.stats.binary,
        truncated,
        additions: loaded.stats.additions,
        deletions: loaded.stats.deletions,
        base_ref: base.as_ref().map(|base| base.base_ref.clone()),
        resolved_base_oid: base.as_ref().map(|base| base.resolved_base_oid.clone()),
        merge_base_oid: base.as_ref().map(|base| base.merge_base_oid.clone()),
        head_oid: base.as_ref().map(|base| base.head_oid.clone()),
        patch,
    }
}

fn truncate_patch(mut patch: String) -> String {
    if patch.len() <= MAX_DIFF_PATCH_BYTES {
        return patch;
    }

    let boundary = patch
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= MAX_DIFF_PATCH_BYTES)
        .last()
        .unwrap_or(0);
    patch.truncate(boundary);
    patch.push_str("\n\n[diff truncated]");
    patch
}

fn normalize_patch(patch: String) -> Option<String> {
    if patch.trim().is_empty() {
        None
    } else {
        Some(patch)
    }
}

fn resolve_branch_diff_base(
    repo_root: &Path,
    base_ref: Option<&str>,
) -> Result<BranchDiffBase, GitDiffError> {
    let candidates = branch_base_candidates(repo_root, base_ref)?;
    for candidate in candidates {
        if let Some(resolved_base_oid) = resolve_branch_ref_to_commit(repo_root, &candidate)? {
            let head_oid = resolve_commit_expr(repo_root, "HEAD^{commit}")
                .map_err(|_| GitDiffError::BaseRefNotFound)?;
            let merge_base_oid = resolve_merge_base(repo_root, &resolved_base_oid, &head_oid)?;
            return Ok(BranchDiffBase {
                base_ref: display_ref_name(&candidate),
                resolved_base_oid,
                merge_base_oid,
                head_oid,
            });
        }
    }

    Err(GitDiffError::BaseRefNotFound)
}

fn branch_base_candidates(
    repo_root: &Path,
    base_ref: Option<&str>,
) -> Result<Vec<String>, GitDiffError> {
    let mut candidates = Vec::new();

    if let Some(base_ref) = base_ref {
        let trimmed = base_ref.trim();
        if trimmed.is_empty() || invalid_base_ref_text(trimmed) {
            return Err(GitDiffError::InvalidBaseRef);
        }
        append_branch_ref_candidates(&mut candidates, trimmed)?;
    } else {
        if let Some(default_branch) = detect_default_branch(repo_root) {
            if !invalid_base_ref_text(&default_branch) {
                append_branch_ref_candidates(&mut candidates, &default_branch)?;
            }
        }
        push_unique(&mut candidates, "refs/remotes/origin/HEAD".to_string());
        for fallback in ["main", "master", "develop"] {
            append_branch_ref_candidates(&mut candidates, fallback)?;
        }
    }

    Ok(candidates)
}

fn append_branch_ref_candidates(
    candidates: &mut Vec<String>,
    base_ref: &str,
) -> Result<(), GitDiffError> {
    if base_ref.starts_with("refs/heads/") || base_ref.starts_with("refs/remotes/") {
        if !is_plausible_full_ref(base_ref) {
            return Err(GitDiffError::InvalidBaseRef);
        }
        push_unique(candidates, base_ref.to_string());
        return Ok(());
    }
    if base_ref.starts_with("refs/") {
        return Err(GitDiffError::InvalidBaseRef);
    }

    if base_ref.contains('/') {
        push_unique(candidates, format!("refs/remotes/{base_ref}"));
        push_unique(candidates, format!("refs/heads/{base_ref}"));
    } else {
        push_unique(candidates, format!("refs/heads/{base_ref}"));
        push_unique(candidates, format!("refs/remotes/origin/{base_ref}"));
    }
    Ok(())
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn invalid_base_ref_text(value: &str) -> bool {
    value.starts_with('-')
        || value.contains("..")
        || value.contains("@{")
        || value.contains('\\')
        || value.contains('^')
        || value.contains('~')
        || value.contains(':')
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
}

fn is_plausible_full_ref(value: &str) -> bool {
    !value.ends_with('/')
        && !value.contains("//")
        && !value
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn resolve_branch_ref_to_commit(
    repo_root: &Path,
    full_ref: &str,
) -> Result<Option<String>, GitDiffError> {
    let check_format = run_git(repo_root, &["check-ref-format", full_ref])?;
    if !check_format.success {
        return Err(GitDiffError::InvalidBaseRef);
    }

    let ref_hash = run_git(repo_root, &["show-ref", "--verify", "--hash", full_ref])?;
    if !ref_hash.success {
        return Ok(None);
    }
    let hash = ref_hash.stdout.trim();
    if hash.is_empty() {
        return Ok(None);
    }

    resolve_commit_expr(repo_root, &format!("{hash}^{{commit}}")).map(Some)
}

fn resolve_commit_expr(repo_root: &Path, expr: &str) -> Result<String, GitDiffError> {
    let output = run_git(
        repo_root,
        &["rev-parse", "--verify", "--quiet", "--end-of-options", expr],
    )?;
    if !output.success {
        return Err(GitDiffError::BaseRefNotFound);
    }
    let oid = output.stdout.trim();
    if oid.is_empty() {
        return Err(GitDiffError::BaseRefNotFound);
    }
    Ok(oid.to_string())
}

fn resolve_merge_base(
    repo_root: &Path,
    resolved_base_oid: &str,
    head_oid: &str,
) -> Result<String, GitDiffError> {
    let merge_base = run_git(repo_root, &["merge-base", resolved_base_oid, head_oid])?;
    if !merge_base.success {
        return Err(GitDiffError::MergeBaseNotFound);
    }
    let oid = merge_base.stdout.trim();
    if oid.is_empty() {
        return Err(GitDiffError::MergeBaseNotFound);
    }
    Ok(oid.to_string())
}

fn display_ref_name(full_ref: &str) -> String {
    full_ref
        .strip_prefix("refs/heads/")
        .or_else(|| full_ref.strip_prefix("refs/remotes/"))
        .unwrap_or(full_ref)
        .to_string()
}

fn run_git_checked(repo_root: &Path, args: &[String]) -> Result<GitOutput, GitDiffError> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(repo_root, &refs)?;
    if output.success {
        Ok(output)
    } else {
        Err(GitDiffError::GitFailed {
            message: git_command_message(&output.stderr, "git diff failed"),
        })
    }
}

fn parse_name_status_z(raw: &str) -> Vec<GitDiffFile> {
    let parts = raw
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut i = 0;

    while i < parts.len() {
        let status_token = parts[i];
        i += 1;
        let Some(status_code) = status_token.chars().next() else {
            continue;
        };

        let status = match status_code {
            'A' => GitFileStatus::Added,
            'D' => GitFileStatus::Deleted,
            'R' => GitFileStatus::Renamed,
            'C' => GitFileStatus::Copied,
            'U' => GitFileStatus::Conflicted,
            'M' | 'T' => GitFileStatus::Modified,
            _ => GitFileStatus::Modified,
        };

        if matches!(status_code, 'R' | 'C') {
            if i + 1 >= parts.len() {
                break;
            }
            let old_path = parts[i].to_string();
            let path = parts[i + 1].to_string();
            i += 2;
            files.push(GitDiffFile {
                path,
                old_path: Some(old_path),
                status,
                additions: 0,
                deletions: 0,
                binary: false,
            });
        } else {
            if i >= parts.len() {
                break;
            }
            let path = parts[i].to_string();
            i += 1;
            files.push(GitDiffFile {
                path,
                old_path: None,
                status,
                additions: 0,
                deletions: 0,
                binary: false,
            });
        }
    }

    files
}

fn parse_numstat_z_map(raw: &str) -> BTreeMap<(Option<String>, String), DiffStats> {
    let parts = raw
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut stats = BTreeMap::new();
    let mut i = 0;

    while i < parts.len() {
        let fields = parts[i].splitn(3, '\t').collect::<Vec<_>>();
        i += 1;
        if fields.len() < 3 {
            continue;
        }

        let stat = parse_numstat_parts(fields[0], fields[1]);
        if fields[2].is_empty() {
            if i + 1 >= parts.len() {
                break;
            }
            let old_path = parts[i].to_string();
            let path = parts[i + 1].to_string();
            i += 2;
            stats.insert((Some(old_path), path), stat);
        } else {
            stats.insert((None, fields[2].to_string()), stat);
        }
    }

    stats
}

fn parse_numstat_summary(raw: &str) -> DiffStats {
    raw.lines()
        .filter_map(|line| {
            let parts = line.splitn(3, '\t').collect::<Vec<_>>();
            if parts.len() < 2 {
                return None;
            }
            Some(parse_numstat_parts(parts[0], parts[1]))
        })
        .fold(DiffStats::default(), combine_stats)
}

fn parse_numstat_parts(additions: &str, deletions: &str) -> DiffStats {
    if additions == "-" && deletions == "-" {
        return DiffStats {
            additions: 0,
            deletions: 0,
            binary: true,
        };
    }

    DiffStats {
        additions: additions.parse().unwrap_or(0),
        deletions: deletions.parse().unwrap_or(0),
        binary: false,
    }
}

fn combine_stats(mut left: DiffStats, right: DiffStats) -> DiffStats {
    left.additions = left.additions.saturating_add(right.additions);
    left.deletions = left.deletions.saturating_add(right.deletions);
    left.binary |= right.binary;
    left
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

fn detect_default_branch(repo_root: &Path) -> Option<String> {
    let out = run_git(repo_root, &["symbolic-ref", "refs/remotes/origin/HEAD"]).ok()?;
    if out.success {
        let refname = out.stdout.trim();
        return refname
            .strip_prefix("refs/remotes/origin/")
            .map(|s| s.to_string());
    }

    for candidate in &["main", "master", "develop"] {
        let check = run_git(
            repo_root,
            &["rev-parse", "--verify", &format!("refs/heads/{candidate}")],
        );
        if let Ok(o) = check {
            if o.success {
                return Some((*candidate).to_string());
            }
        }
    }
    None
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "anyharness-git-{prefix}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn init_repo() -> TempDirGuard {
        let repo = TempDirGuard::new("repo");
        run_git_cmd(repo.path(), ["init", "-b", "main"]);
        run_git_cmd(repo.path(), ["config", "user.email", "codex@example.com"]);
        run_git_cmd(repo.path(), ["config", "user.name", "Codex"]);
        repo
    }

    fn commit_file(repo: &Path, path: &str, content: &str, message: &str) -> String {
        fs::write(repo.join(path), content).expect("write file");
        run_git_cmd(repo, ["add", path]);
        run_git_cmd(repo, ["commit", "-m", message]);
        git_stdout(repo, ["rev-parse", "HEAD"])
    }

    fn git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("utf8")
            .trim()
            .to_string()
    }

    fn run_git_cmd<const N: usize>(cwd: &Path, args: [&str; N]) {
        let _ = git_stdout(cwd, args);
    }

    #[test]
    fn working_tree_scope_falls_back_to_staged_patch_and_stats() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        fs::write(repo.path().join("tracked.txt"), "one\ntwo\n").expect("write file");
        run_git_cmd(repo.path(), ["add", "tracked.txt"]);

        let diff = GitService::diff_for_path_with_scope(
            repo.path(),
            "tracked.txt",
            GitDiffScope::WorkingTree,
            None,
            None,
        )
        .expect("diff");

        assert_eq!(diff.scope, GitDiffScope::WorkingTree);
        assert!(diff.patch.as_deref().unwrap_or_default().contains("+two"));
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 0);
    }

    #[test]
    fn branch_base_ref_rejects_revision_syntax() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");

        let error =
            GitService::branch_diff_files(repo.path(), Some("main^")).expect_err("invalid ref");

        assert!(matches!(error, GitDiffError::InvalidBaseRef));
    }

    #[test]
    fn branch_base_ref_uses_remote_main_when_local_main_absent() {
        let repo = init_repo();
        let base_oid = commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        run_git_cmd(repo.path(), ["checkout", "-b", "feature"]);
        run_git_cmd(repo.path(), ["branch", "-D", "main"]);
        run_git_cmd(
            repo.path(),
            ["update-ref", "refs/remotes/origin/main", &base_oid],
        );
        commit_file(repo.path(), "feature.txt", "feature\n", "feature");

        let response = GitService::branch_diff_files(repo.path(), Some("main")).expect("files");

        assert_eq!(response.base_ref, "origin/main");
        assert_eq!(response.files.len(), 1);
        assert_eq!(response.files[0].path, "feature.txt");
    }

    #[test]
    fn branch_base_ref_does_not_let_tag_named_main_win() {
        let repo = init_repo();
        commit_file(repo.path(), "tracked.txt", "one\n", "initial");
        run_git_cmd(repo.path(), ["checkout", "-b", "feature"]);
        commit_file(repo.path(), "feature.txt", "feature\n", "feature");
        run_git_cmd(repo.path(), ["tag", "main"]);

        let response = GitService::branch_diff_files(repo.path(), Some("main")).expect("files");

        assert_eq!(response.base_ref, "main");
        assert!(response.files.iter().any(|file| file.path == "feature.txt"));
    }

    #[test]
    fn branch_renamed_file_diff_uses_old_path_to_preserve_rename_patch() {
        let repo = init_repo();
        commit_file(repo.path(), "old.txt", "one\n", "initial");
        run_git_cmd(repo.path(), ["checkout", "-b", "feature"]);
        run_git_cmd(repo.path(), ["mv", "old.txt", "new.txt"]);
        run_git_cmd(repo.path(), ["commit", "-m", "rename"]);

        let files = GitService::branch_diff_files(repo.path(), Some("main")).expect("files");
        let renamed = files
            .files
            .iter()
            .find(|file| file.path == "new.txt")
            .expect("renamed file");
        assert_eq!(renamed.status, GitFileStatus::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));

        let diff = GitService::diff_for_path_with_scope(
            repo.path(),
            "new.txt",
            GitDiffScope::Branch,
            Some("main"),
            Some("old.txt"),
        )
        .expect("diff");

        let patch = diff.patch.as_deref().unwrap_or_default();
        assert!(patch.contains("rename from old.txt"), "{patch}");
        assert!(patch.contains("rename to new.txt"), "{patch}");
    }
}
