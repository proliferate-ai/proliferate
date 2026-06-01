use std::path::{Path, PathBuf};
use std::time::Instant;

use super::super::default_branch::detect_default_branch;
use super::super::executor::{run_git, run_git_ok};
use super::super::parse_status::parse_porcelain_v2;
use super::super::types::{
    GitActionAvailability, GitChangedFile, GitFileStatus, GitIncludedState, GitStatusSnapshot,
    GitStatusSummary,
};
use super::status_operation::detect_operation;

pub fn status(workspace_id: &str, workspace_path: &Path) -> anyhow::Result<GitStatusSnapshot> {
    let started = Instant::now();
    let repo_root_started = Instant::now();
    let repo_root = run_git_ok(workspace_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let repo_root_path = PathBuf::from(&repo_root);
    tracing::info!(
        workspace_id = %workspace_id,
        elapsed_ms = repo_root_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.repo_root_resolved"
    );

    let porcelain_started = Instant::now();
    let raw = run_git_ok(
        &repo_root_path,
        &["status", "--porcelain=v2", "--branch", "-z"],
    )?;
    tracing::info!(
        workspace_id = %workspace_id,
        output_bytes = raw.len(),
        elapsed_ms = porcelain_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.porcelain_loaded"
    );

    let parse_started = Instant::now();
    let mut parsed = parse_porcelain_v2(&raw);
    tracing::info!(
        workspace_id = %workspace_id,
        changed_files = parsed.files.len(),
        elapsed_ms = parse_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.porcelain_parsed"
    );

    let operation_started = Instant::now();
    parsed.operation = detect_operation(&repo_root_path);
    tracing::info!(
        workspace_id = %workspace_id,
        operation = ?parsed.operation,
        elapsed_ms = operation_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.operation_detected"
    );

    let enrich_started = Instant::now();
    enrich_file_stats(workspace_id, &repo_root_path, &mut parsed.files);
    tracing::info!(
        workspace_id = %workspace_id,
        changed_files = parsed.files.len(),
        elapsed_ms = enrich_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.file_stats_enriched"
    );

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

    let default_branch_started = Instant::now();
    let suggested_base = detect_default_branch(&repo_root_path);
    tracing::info!(
        workspace_id = %workspace_id,
        has_suggested_base = suggested_base.is_some(),
        elapsed_ms = default_branch_started.elapsed().as_millis(),
        total_elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.default_branch_detected"
    );

    let snapshot = GitStatusSnapshot {
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
    };
    tracing::info!(
        workspace_id = %workspace_id,
        changed_files = snapshot.summary.changed_files,
        additions = snapshot.summary.additions,
        deletions = snapshot.summary.deletions,
        elapsed_ms = started.elapsed().as_millis(),
        "[anyharness-latency] git.status.completed"
    );
    Ok(snapshot)
}

fn enrich_file_stats(workspace_id: &str, repo_root: &Path, files: &mut [GitChangedFile]) {
    let unstaged_started = Instant::now();
    let numstat = run_git(repo_root, &["diff", "--numstat", "-z"]);
    let unstaged_elapsed_ms = unstaged_started.elapsed().as_millis();
    let unstaged_success = numstat
        .as_ref()
        .map(|output| output.success)
        .unwrap_or(false);

    let staged_started = Instant::now();
    let staged_numstat = run_git(repo_root, &["diff", "--cached", "--numstat", "-z"]);
    let staged_elapsed_ms = staged_started.elapsed().as_millis();
    let staged_success = staged_numstat
        .as_ref()
        .map(|output| output.success)
        .unwrap_or(false);

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
    tracing::info!(
        workspace_id = %workspace_id,
        file_count = files.len(),
        unstaged_elapsed_ms,
        unstaged_success,
        staged_elapsed_ms,
        staged_success,
        "[anyharness-latency] git.status.numstat_loaded"
    );
}
