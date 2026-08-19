use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::adapters::files::safety::{
    classify_io_error, resolve_safe_path, ClassifiedIoError, SafetyError,
};
use crate::adapters::files::types::FileServiceError;

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
    ) -> Result<Vec<WorkspaceFileSearchMatch>, FileServiceError> {
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
    ) -> Result<Arc<WorkspaceFileSearchSnapshot>, FileServiceError> {
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

fn build_snapshot(workspace_path: &Path) -> Result<WorkspaceFileSearchSnapshot, FileServiceError> {
    let raw_paths = run_scoped_git_file_list(workspace_path)?;

    let mut entries = Vec::new();
    for path in raw_paths.split('\0') {
        if let Some(candidate) = build_candidate(workspace_path, path)? {
            entries.push(candidate);
        }
    }

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

fn run_scoped_git_file_list(workspace_path: &Path) -> Result<String, FileServiceError> {
    let output = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
        ])
        .current_dir(workspace_path)
        .output()
        .map_err(map_git_invocation_error)?;
    if !output.status.success() {
        return Err(FileServiceError::Io);
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn map_git_invocation_error(error: std::io::Error) -> FileServiceError {
    match classify_io_error(&error) {
        ClassifiedIoError::PermissionDenied => FileServiceError::PermissionDenied,
        ClassifiedIoError::NotFound
        | ClassifiedIoError::NotADirectory
        | ClassifiedIoError::Unexpected => FileServiceError::Io,
    }
}

fn build_candidate(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<Option<WorkspaceFileSearchCandidate>, FileServiceError> {
    if relative_path.is_empty() {
        return Ok(None);
    }

    let resolved_path = match resolve_safe_path(workspace_root, relative_path) {
        Ok(path) => path,
        Err(
            SafetyError::NotFound
            | SafetyError::NotADirectory
            | SafetyError::OutsideWorkspace
            | SafetyError::GitDirectory
            | SafetyError::AbsolutePath
            | SafetyError::TraversalAttempt
            | SafetyError::InvalidPath,
        ) => return Ok(None),
        Err(SafetyError::PermissionDenied) => return Err(FileServiceError::PermissionDenied),
        Err(SafetyError::IoError) => return Err(FileServiceError::Io),
    };
    let metadata = match resolved_path.metadata() {
        Ok(metadata) => metadata,
        Err(error) => match FileServiceError::from_io(error, relative_path) {
            FileServiceError::NotFound(_) | FileServiceError::NotADirectory(_) => return Ok(None),
            error => return Err(error),
        },
    };
    if !metadata.is_file() {
        return Ok(None);
    }

    let name = Path::new(relative_path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    let Some(name) = name else {
        return Ok(None);
    };
    let path = normalize_relative_path(relative_path);

    Ok(Some(WorkspaceFileSearchCandidate {
        path_lower: path.to_lowercase(),
        name_lower: name.to_lowercase(),
        path,
        name,
    }))
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

    use super::{
        build_snapshot, map_git_invocation_error, search_snapshot, WorkspaceFileSearchCache,
    };
    use crate::adapters::files::types::FileServiceError;

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
    fn nested_workspace_snapshot_excludes_repository_siblings() {
        let repo = TestRepo::new();
        repo.write("repository-sibling.txt", "outside workspace");
        repo.write("nested-workspace/inside.txt", "inside workspace");
        repo.write(
            "nested-workspace/deeper/also-inside.txt",
            "inside workspace",
        );
        repo.git(&["add", "."]);

        let workspace = repo.root.join("nested-workspace");
        let snapshot = build_snapshot(&workspace).expect("expected nested snapshot");
        let paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["deeper/also-inside.txt", "inside.txt"]);
        assert!(!paths.contains(&"repository-sibling.txt"));
        assert!(paths
            .iter()
            .all(|path| !path.starts_with("nested-workspace/")));
    }

    #[test]
    fn snapshot_omits_tracked_candidate_below_regular_file() {
        let repo = TestRepo::new();
        repo.write("parent-file/missing/child.txt", "tracked child");
        repo.git(&["add", "."]);
        fs::remove_dir_all(repo.root.join("parent-file")).expect("replace tracked directory");
        fs::write(repo.root.join("parent-file"), "regular file").expect("seed file ancestor");

        let snapshot = build_snapshot(&repo.root).expect("expected safe snapshot");
        let paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();

        assert!(!paths.contains(&"parent-file/missing/child.txt"));
    }

    #[test]
    fn git_invocation_io_mapper_keeps_permission_distinct() {
        let denied =
            map_git_invocation_error(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        let missing_binary =
            map_git_invocation_error(std::io::Error::from(std::io::ErrorKind::NotFound));
        let unexpected = map_git_invocation_error(std::io::Error::from(std::io::ErrorKind::Other));

        assert!(matches!(denied, FileServiceError::PermissionDenied));
        assert!(matches!(missing_binary, FileServiceError::Io));
        assert!(matches!(unexpected, FileServiceError::Io));
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_uses_workspace_authority_for_symlink_candidates() {
        let repo = TestRepo::new();
        repo.write("target.txt", "target");
        repo.write("target-dir/child.txt", "child");
        let external =
            std::env::temp_dir().join(format!("anyharness-search-external-{}", Uuid::new_v4()));
        fs::write(&external, "external").expect("seed external target");
        std::os::unix::fs::symlink("target.txt", repo.root.join("file-link"))
            .expect("seed file link");
        std::os::unix::fs::symlink("target-dir", repo.root.join("directory-link"))
            .expect("seed directory link");
        std::os::unix::fs::symlink("missing", repo.root.join("dangling-link"))
            .expect("seed dangling link");
        std::os::unix::fs::symlink(&external, repo.root.join("escaping-link"))
            .expect("seed escaping link");
        std::os::unix::fs::symlink(".git", repo.root.join("git-link")).expect("seed git link");

        let snapshot = build_snapshot(&repo.root).expect("expected safe snapshot");
        let paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();

        assert!(paths.contains(&"file-link"));
        assert!(paths.contains(&"target.txt"));
        assert!(paths.contains(&"target-dir/child.txt"));
        assert!(!paths.contains(&"directory-link"));
        assert!(!paths.contains(&"dangling-link"));
        assert!(!paths.contains(&"escaping-link"));
        assert!(!paths.contains(&"git-link"));

        let link = snapshot
            .entries
            .iter()
            .find(|entry| entry.path == "file-link")
            .expect("contained file link candidate");
        assert_eq!(link.name, "file-link");
        let _ = fs::remove_file(external);
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
