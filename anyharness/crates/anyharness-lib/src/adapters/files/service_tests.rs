use std::path::{Path, PathBuf};

use super::safety::SafetyError;
use super::service::{FileServiceError, WorkspaceFilesService};
use super::types::{CreateWorkspaceFileEntryKind, WorkspaceFileKind};

#[test]
fn create_entry_creates_new_file_with_read_metadata() {
    let dir = TestWorkspace::new();
    std::fs::create_dir(dir.path().join("src")).expect("seed parent");

    let result = WorkspaceFilesService::create_entry(
        dir.path(),
        "src/main.rs",
        CreateWorkspaceFileEntryKind::File,
        Some("fn main() {}\n"),
    )
    .expect("create file");

    assert_eq!(result.entry.path, "src/main.rs");
    assert_eq!(result.entry.kind, WorkspaceFileKind::File);
    let file = result.file.expect("created file read response");
    assert_eq!(file.path, "src/main.rs");
    assert_eq!(file.content.as_deref(), Some("fn main() {}\n"));
    assert!(file.version_token.is_some());
}

#[test]
fn create_entry_creates_new_directory_without_file_response() {
    let dir = TestWorkspace::new();

    let result = WorkspaceFilesService::create_entry(
        dir.path(),
        "src",
        CreateWorkspaceFileEntryKind::Directory,
        None,
    )
    .expect("create directory");

    assert_eq!(result.entry.path, "src");
    assert_eq!(result.entry.kind, WorkspaceFileKind::Directory);
    assert!(result.file.is_none());
}

#[test]
fn create_entry_fails_for_existing_path() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

    let error = WorkspaceFilesService::create_entry(
        dir.path(),
        "README.md",
        CreateWorkspaceFileEntryKind::File,
        None,
    )
    .expect_err("existing path should fail");

    assert!(matches!(error, FileServiceError::AlreadyExists(path) if path == "README.md"));
}

#[test]
fn create_entry_fails_when_parent_is_missing() {
    let dir = TestWorkspace::new();

    let error = WorkspaceFilesService::create_entry(
        dir.path(),
        "missing/file.txt",
        CreateWorkspaceFileEntryKind::File,
        None,
    )
    .expect_err("missing parent should fail");

    assert!(matches!(error, FileServiceError::NotADirectory(_)));
}

#[test]
fn create_entry_rejects_directory_content() {
    let dir = TestWorkspace::new();

    let error = WorkspaceFilesService::create_entry(
        dir.path(),
        "src",
        CreateWorkspaceFileEntryKind::Directory,
        Some("nope"),
    )
    .expect_err("directory content should fail");

    assert!(matches!(error, FileServiceError::InvalidCreateRequest(_)));
}

#[test]
fn create_entry_rejects_git_paths() {
    let dir = TestWorkspace::new();

    let error = WorkspaceFilesService::create_entry(
        dir.path(),
        ".git/config",
        CreateWorkspaceFileEntryKind::File,
        None,
    )
    .expect_err(".git should be protected");

    assert!(matches!(
        error,
        FileServiceError::Safety(SafetyError::GitDirectory)
    ));
}

#[cfg(unix)]
#[test]
fn create_entry_rejects_git_symlink_parent() {
    let dir = TestWorkspace::new();
    std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
    std::os::unix::fs::symlink(".git", dir.path().join("gitlink")).expect("seed git symlink");

    let error = WorkspaceFilesService::create_entry(
        dir.path(),
        "gitlink/new-file",
        CreateWorkspaceFileEntryKind::File,
        None,
    )
    .expect_err("git symlink parent should be protected");

    assert!(matches!(
        error,
        FileServiceError::Safety(SafetyError::GitDirectory)
    ));
    assert!(!dir.path().join(".git/new-file").exists());
}

#[test]
fn rename_entry_moves_file_to_new_path() {
    let dir = TestWorkspace::new();
    std::fs::create_dir(dir.path().join("src")).expect("seed parent");
    std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

    let result = WorkspaceFilesService::rename_entry(dir.path(), "README.md", "src/README.md")
        .expect("rename file");

    assert_eq!(result.old_path, "README.md");
    assert_eq!(result.entry.path, "src/README.md");
    assert_eq!(result.entry.kind, WorkspaceFileKind::File);
    assert!(!dir.path().join("README.md").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("src/README.md")).expect("read renamed file"),
        "hello"
    );
}

#[test]
fn rename_entry_fails_for_existing_destination() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("a.txt"), "a").expect("seed source");
    std::fs::write(dir.path().join("b.txt"), "b").expect("seed destination");

    let error = WorkspaceFilesService::rename_entry(dir.path(), "a.txt", "b.txt")
        .expect_err("existing destination should fail");

    assert!(matches!(error, FileServiceError::AlreadyExists(path) if path == "b.txt"));
}

#[test]
fn rename_entry_fails_when_destination_parent_is_missing() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("a.txt"), "a").expect("seed source");

    let error = WorkspaceFilesService::rename_entry(dir.path(), "a.txt", "missing/a.txt")
        .expect_err("missing parent should fail");

    assert!(matches!(error, FileServiceError::NotADirectory(_)));
}

#[test]
fn rename_entry_rejects_git_paths() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("a.txt"), "a").expect("seed source");

    let error = WorkspaceFilesService::rename_entry(dir.path(), "a.txt", ".git/a.txt")
        .expect_err(".git should be protected");

    assert!(matches!(
        error,
        FileServiceError::Safety(SafetyError::GitDirectory)
    ));
}

#[cfg(unix)]
#[test]
fn rename_entry_moves_symlink_without_moving_target() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("target.txt"), "target").expect("seed target");
    std::os::unix::fs::symlink("target.txt", dir.path().join("link.txt")).expect("seed symlink");

    let result = WorkspaceFilesService::rename_entry(dir.path(), "link.txt", "renamed.txt")
        .expect("rename symlink");

    assert_eq!(result.old_path, "link.txt");
    assert_eq!(result.entry.path, "renamed.txt");
    assert_eq!(result.entry.kind, WorkspaceFileKind::Symlink);
    assert!(!dir.path().join("link.txt").exists());
    assert!(dir
        .path()
        .join("renamed.txt")
        .symlink_metadata()
        .expect("renamed link")
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("target.txt")).expect("target remains"),
        "target"
    );
}

#[test]
fn delete_entry_removes_file() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

    let result = WorkspaceFilesService::delete_entry(dir.path(), "README.md").expect("delete file");

    assert_eq!(result.path, "README.md");
    assert_eq!(result.kind, WorkspaceFileKind::File);
    assert!(!dir.path().join("README.md").exists());
}

#[test]
fn delete_entry_removes_directory_recursively() {
    let dir = TestWorkspace::new();
    std::fs::create_dir_all(dir.path().join("src/nested")).expect("seed dir");
    std::fs::write(dir.path().join("src/nested/main.rs"), "fn main() {}")
        .expect("seed nested file");

    let result = WorkspaceFilesService::delete_entry(dir.path(), "src").expect("delete directory");

    assert_eq!(result.path, "src");
    assert_eq!(result.kind, WorkspaceFileKind::Directory);
    assert!(!dir.path().join("src").exists());
}

#[cfg(unix)]
#[test]
fn delete_entry_removes_symlink_without_deleting_target_file() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("target.txt"), "target").expect("seed target");
    std::os::unix::fs::symlink("target.txt", dir.path().join("link.txt")).expect("seed symlink");

    let result =
        WorkspaceFilesService::delete_entry(dir.path(), "link.txt").expect("delete symlink");

    assert_eq!(result.path, "link.txt");
    assert_eq!(result.kind, WorkspaceFileKind::Symlink);
    assert!(!dir.path().join("link.txt").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("target.txt")).expect("target remains"),
        "target"
    );
}

#[cfg(unix)]
#[test]
fn delete_entry_removes_directory_symlink_without_deleting_target_directory() {
    let dir = TestWorkspace::new();
    std::fs::create_dir_all(dir.path().join("target-dir/nested")).expect("seed target dir");
    std::fs::write(dir.path().join("target-dir/nested/file.txt"), "target")
        .expect("seed nested target");
    std::os::unix::fs::symlink("target-dir", dir.path().join("dir-link"))
        .expect("seed directory symlink");

    let result =
        WorkspaceFilesService::delete_entry(dir.path(), "dir-link").expect("delete symlink");

    assert_eq!(result.path, "dir-link");
    assert_eq!(result.kind, WorkspaceFileKind::Symlink);
    assert!(!dir.path().join("dir-link").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("target-dir/nested/file.txt"))
            .expect("target directory remains"),
        "target"
    );
}

#[cfg(unix)]
#[test]
fn delete_entry_allows_symlink_to_external_target() {
    let dir = TestWorkspace::new();
    let external = std::env::temp_dir().join(format!(
        "anyharness-files-external-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&external, "outside").expect("seed external target");
    std::os::unix::fs::symlink(&external, dir.path().join("external-link"))
        .expect("seed external symlink");

    let result = WorkspaceFilesService::delete_entry(dir.path(), "external-link")
        .expect("delete external symlink");

    assert_eq!(result.path, "external-link");
    assert_eq!(result.kind, WorkspaceFileKind::Symlink);
    assert!(!dir.path().join("external-link").exists());
    assert_eq!(
        std::fs::read_to_string(&external).expect("external target remains"),
        "outside"
    );
    let _ = std::fs::remove_file(external);
}

#[cfg(unix)]
#[test]
fn delete_entry_rejects_git_symlink_descendant_but_allows_link_entry() {
    let dir = TestWorkspace::new();
    std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
    std::fs::write(dir.path().join(".git/config"), "git config").expect("seed git config");
    std::os::unix::fs::symlink(".git", dir.path().join("gitlink")).expect("seed git symlink");

    let error = WorkspaceFilesService::delete_entry(dir.path(), "gitlink/config")
        .expect_err("git symlink descendant should be protected");

    assert!(matches!(
        error,
        FileServiceError::Safety(SafetyError::GitDirectory)
    ));
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".git/config")).expect("git config remains"),
        "git config"
    );

    let result = WorkspaceFilesService::delete_entry(dir.path(), "gitlink")
        .expect("delete git symlink entry");

    assert_eq!(result.path, "gitlink");
    assert_eq!(result.kind, WorkspaceFileKind::Symlink);
    assert!(dir.path().join("gitlink").symlink_metadata().is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".git/config")).expect("git config remains"),
        "git config"
    );
}

#[cfg(unix)]
#[test]
fn rename_entry_rejects_git_symlink_descendant() {
    let dir = TestWorkspace::new();
    std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
    std::fs::write(dir.path().join(".git/config"), "git config").expect("seed git config");
    std::os::unix::fs::symlink(".git", dir.path().join("gitlink")).expect("seed git symlink");

    let error = WorkspaceFilesService::rename_entry(dir.path(), "gitlink/config", "config-copy")
        .expect_err("git symlink descendant should be protected");

    assert!(matches!(
        error,
        FileServiceError::Safety(SafetyError::GitDirectory)
    ));
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".git/config")).expect("git config remains"),
        "git config"
    );
    assert!(!dir.path().join("config-copy").exists());
}

#[test]
fn delete_entry_rejects_git_paths() {
    let dir = TestWorkspace::new();

    let error = WorkspaceFilesService::delete_entry(dir.path(), ".git/config")
        .expect_err(".git should be protected");

    assert!(matches!(
        error,
        FileServiceError::Safety(SafetyError::GitDirectory)
    ));
}

struct TestWorkspace {
    path: PathBuf,
}

impl TestWorkspace {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("anyharness-files-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).expect("create temp workspace");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
