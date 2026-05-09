use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use super::executor::{resolve_git_repo_root, run_git_ok};

const SNAPSHOT_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceFileSearchMatch {
    pub path: String,
    pub name: String,
}

#[derive(Debug)]
pub struct WorkspaceFileSearchCandidate {
    path: String,
    name: String,
    path_lower: String,
    name_lower: String,
}

#[derive(Debug)]
pub struct WorkspaceFileSearchSnapshot {
    built_at: Instant,
    entries: Arc<[WorkspaceFileSearchCandidate]>,
}

#[derive(Debug, Default)]
pub struct WorkspaceFileSearchCache {
    snapshots: RwLock<HashMap<String, Arc<WorkspaceFileSearchSnapshot>>>,
}

impl WorkspaceFileSearchCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn search(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        query: &str,
        limit: usize,
    ) -> anyhow::Result<Vec<WorkspaceFileSearchMatch>> {
        let snapshot = self.snapshot_for_workspace(workspace_id, workspace_path)?;
        Ok(search_snapshot(snapshot.as_ref(), query, limit))
    }

    pub fn invalidate(&self, workspace_id: &str) {
        if let Ok(mut snapshots) = self.snapshots.write() {
            snapshots.remove(workspace_id);
        }
    }

    fn snapshot_for_workspace(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> anyhow::Result<Arc<WorkspaceFileSearchSnapshot>> {
        if let Some(snapshot) = self
            .snapshots
            .read()
            .expect("workspace file search cache poisoned")
            .get(workspace_id)
            .cloned()
        {
            if snapshot.built_at.elapsed() < SNAPSHOT_TTL {
                return Ok(snapshot);
            }
        }

        let snapshot = Arc::new(build_snapshot(workspace_path)?);
        self.snapshots
            .write()
            .expect("workspace file search cache poisoned")
            .insert(workspace_id.to_string(), snapshot.clone());
        Ok(snapshot)
    }
}

fn build_snapshot(workspace_path: &Path) -> anyhow::Result<WorkspaceFileSearchSnapshot> {
    let repo_root = resolve_git_repo_root(workspace_path)?;
    let raw_paths = run_git_ok(
        &repo_root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;

    let mut entries = raw_paths
        .split('\0')
        .filter_map(|path| build_candidate(&repo_root, path))
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        left.name_lower
            .cmp(&right.name_lower)
            .then_with(|| left.path_lower.cmp(&right.path_lower))
    });

    Ok(WorkspaceFileSearchSnapshot {
        built_at: Instant::now(),
        entries: Arc::from(entries.into_boxed_slice()),
    })
}

fn build_candidate(repo_root: &Path, relative_path: &str) -> Option<WorkspaceFileSearchCandidate> {
    let relative_path = relative_path.trim();
    if relative_path.is_empty() {
        return None;
    }

    let absolute_path = repo_root.join(relative_path);
    let metadata = std::fs::symlink_metadata(&absolute_path).ok()?;
    let file_type = metadata.file_type();

    if file_type.is_dir() {
        return None;
    }

    if file_type.is_symlink() {
        let target_metadata = std::fs::metadata(&absolute_path).ok()?;
        if !target_metadata.is_file() {
            return None;
        }
    } else if !file_type.is_file() {
        return None;
    }

    let name = Path::new(relative_path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())?;
    let path = normalize_relative_path(relative_path);

    Some(WorkspaceFileSearchCandidate {
        path_lower: path.to_lowercase(),
        name_lower: name.to_lowercase(),
        path,
        name,
    })
}

fn normalize_relative_path(path: &str) -> String {
    if std::path::MAIN_SEPARATOR == '/' {
        path.to_string()
    } else {
        path.replace('\\', "/")
    }
}

fn search_snapshot(
    snapshot: &WorkspaceFileSearchSnapshot,
    query: &str,
    limit: usize,
) -> Vec<WorkspaceFileSearchMatch> {
    if snapshot.entries.is_empty() || limit == 0 {
        return Vec::new();
    }

    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return snapshot
            .entries
            .iter()
            .take(limit)
            .map(|entry| WorkspaceFileSearchMatch {
                path: entry.path.clone(),
                name: entry.name.clone(),
            })
            .collect();
    }

    let query_lower = trimmed_query.to_lowercase();
    let pattern = Pattern::parse(trimmed_query, CaseMatching::Ignore, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut name_buf = Vec::new();
    let mut path_buf = Vec::new();

    let mut matches = snapshot
        .entries
        .iter()
        .filter_map(|entry| {
            let name_score = pattern.score(Utf32Str::new(&entry.name, &mut name_buf), &mut matcher);
            let path_score = pattern.score(Utf32Str::new(&entry.path, &mut path_buf), &mut matcher);
            if name_score.is_none() && path_score.is_none() {
                return None;
            }
            let total_score = exact_basename_bonus(entry, &query_lower)
                + basename_prefix_bonus(entry, &query_lower)
                + (name_score.unwrap_or(0) * 8)
                + path_score.unwrap_or(0);

            Some(ScoredWorkspaceFileSearchMatch {
                path: entry.path.clone(),
                name: entry.name.clone(),
                total_score,
            })
        })
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| {
        right
            .total_score
            .cmp(&left.total_score)
            .then_with(|| left.name.len().cmp(&right.name.len()))
            .then_with(|| left.path.len().cmp(&right.path.len()))
            .then_with(|| left.path.cmp(&right.path))
    });

    matches.truncate(limit);
    matches
        .into_iter()
        .map(|entry| WorkspaceFileSearchMatch {
            path: entry.path,
            name: entry.name,
        })
        .collect()
}

fn exact_basename_bonus(entry: &WorkspaceFileSearchCandidate, query_lower: &str) -> u32 {
    if entry.name_lower == query_lower {
        1_000_000
    } else {
        0
    }
}

fn basename_prefix_bonus(entry: &WorkspaceFileSearchCandidate, query_lower: &str) -> u32 {
    if entry.name_lower.starts_with(query_lower) {
        500_000
    } else {
        0
    }
}

#[derive(Debug)]
struct ScoredWorkspaceFileSearchMatch {
    path: String,
    name: String,
    total_score: u32,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::Arc;

    use uuid::Uuid;

    use super::{build_snapshot, search_snapshot, WorkspaceFileSearchCache};

    struct TestRepo {
        root: PathBuf,
    }

    impl TestRepo {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("anyharness-file-search-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("expected temp repo");
            run_git(&root, &["init"]);
            Self { root }
        }

        fn write(&self, path: &str, content: &str) {
            let absolute = self.root.join(path);
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent).expect("expected parent dir");
            }
            fs::write(absolute, content).expect("expected file write");
        }

        fn git(&self, args: &[&str]) {
            run_git(&self.root, args);
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn build_snapshot_respects_gitignore() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "node_modules/\nignored.log\n");
        repo.write("src/main.ts", "console.log('hi');\n");
        repo.write("notes/todo.md", "# todo\n");
        repo.write("node_modules/react/index.js", "export {};\n");
        repo.write("ignored.log", "ignore me\n");
        repo.git(&["add", ".gitignore", "src/main.ts"]);

        let snapshot = build_snapshot(&repo.root).expect("expected snapshot");
        let paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();

        assert!(paths.contains(&".gitignore"));
        assert!(paths.contains(&"src/main.ts"));
        assert!(paths.contains(&"notes/todo.md"));
        assert!(!paths.contains(&"node_modules/react/index.js"));
        assert!(!paths.contains(&"ignored.log"));
    }

    #[test]
    fn search_exact_basename_beats_path_only_match() {
        let repo = TestRepo::new();
        repo.write("foo.ts", "");
        repo.write("src/foo-helper.ts", "");
        repo.write("src/components/bar.ts", "");
        repo.git(&["add", "."]);

        let snapshot = build_snapshot(&repo.root).expect("expected snapshot");
        let results = search_snapshot(&snapshot, "foo.ts", 10);

        assert_eq!(
            results.first().map(|entry| entry.path.as_str()),
            Some("foo.ts")
        );
    }

    #[test]
    fn search_returns_path_only_matches() {
        let repo = TestRepo::new();
        repo.write("src/components/file-palette.ts", "");
        repo.write("src/components/palette-row.ts", "");
        repo.git(&["add", "."]);

        let snapshot = build_snapshot(&repo.root).expect("expected snapshot");
        let results = search_snapshot(&snapshot, "components file", 10);

        assert!(results
            .iter()
            .any(|entry| entry.path == "src/components/file-palette.ts"));
    }

    #[test]
    fn search_basename_prefix_beats_substring() {
        let repo = TestRepo::new();
        repo.write("foobar.ts", "");
        repo.write("src/barfoo.ts", "");
        repo.git(&["add", "."]);

        let snapshot = build_snapshot(&repo.root).expect("expected snapshot");
        let results = search_snapshot(&snapshot, "foo", 10);

        assert_eq!(
            results.first().map(|entry| entry.path.as_str()),
            Some("foobar.ts")
        );
    }

    #[test]
    fn blank_query_returns_deterministic_snapshot_order() {
        let repo = TestRepo::new();
        repo.write("src/zeta.ts", "");
        repo.write("alpha.ts", "");
        repo.write("docs/alpha.ts", "");
        repo.git(&["add", "."]);

        let snapshot = build_snapshot(&repo.root).expect("expected snapshot");
        let results = search_snapshot(&snapshot, "", 10);

        assert_eq!(
            results
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha.ts", "docs/alpha.ts", "src/zeta.ts"]
        );
    }

    #[test]
    fn cache_reuses_and_invalidates_snapshots() {
        let repo = TestRepo::new();
        repo.write("alpha.ts", "");
        repo.git(&["add", "."]);

        let cache = WorkspaceFileSearchCache::new();
        let first = cache
            .snapshot_for_workspace("workspace-1", &repo.root)
            .expect("expected snapshot");
        let second = cache
            .snapshot_for_workspace("workspace-1", &repo.root)
            .expect("expected cached snapshot");

        assert!(Arc::ptr_eq(&first, &second));

        cache.invalidate("workspace-1");
        let third = cache
            .snapshot_for_workspace("workspace-1", &repo.root)
            .expect("expected rebuilt snapshot");

        assert!(!Arc::ptr_eq(&first, &third));
    }

    fn run_git(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .expect("expected git command");
        assert!(status.success(), "git {:?} should succeed", args);
    }
}
