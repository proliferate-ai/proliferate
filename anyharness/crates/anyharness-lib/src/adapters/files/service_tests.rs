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
fn rename_and_delete_directory_symlink_preserve_target_directory() {
    let dir = TestWorkspace::new();
    std::fs::create_dir_all(dir.path().join("target-dir/nested")).expect("seed target dir");
    std::fs::write(dir.path().join("target-dir/nested/file.txt"), "target")
        .expect("seed nested target");
    std::os::unix::fs::symlink("target-dir", dir.path().join("dir-link"))
        .expect("seed directory symlink");

    let renamed = WorkspaceFilesService::rename_entry(dir.path(), "dir-link", "renamed-dir-link")
        .expect("rename directory symlink");
    assert_eq!(renamed.entry.kind, WorkspaceFileKind::Symlink);
    assert!(dir.path().join("dir-link").symlink_metadata().is_err());
    assert!(dir
        .path()
        .join("renamed-dir-link")
        .symlink_metadata()
        .expect("renamed directory link")
        .file_type()
        .is_symlink());

    let result = WorkspaceFilesService::delete_entry(dir.path(), "renamed-dir-link")
        .expect("delete symlink");

    assert_eq!(result.path, "renamed-dir-link");
    assert_eq!(result.kind, WorkspaceFileKind::Symlink);
    assert!(dir
        .path()
        .join("renamed-dir-link")
        .symlink_metadata()
        .is_err());
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

#[test]
fn workspace_root_has_explicit_read_only_behavior() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("README.md"), "hello").expect("seed file");

    let stat = WorkspaceFilesService::stat_file(dir.path(), "").expect("stat root");
    assert_eq!(stat.path, "");
    assert_eq!(stat.kind, WorkspaceFileKind::Directory);

    let listing = WorkspaceFilesService::list_entries(dir.path(), "").expect("list root");
    assert_eq!(listing.directory_path, "");
    assert_eq!(listing.entries.len(), 1);
    assert_eq!(listing.entries[0].path, "README.md");

    assert!(matches!(
        WorkspaceFilesService::read_file(dir.path(), "").expect_err("root is not a file"),
        FileServiceError::NotAFile(path) if path.is_empty()
    ));
    assert!(matches!(
        WorkspaceFilesService::write_file(dir.path(), "", "new", "")
            .expect_err("root is not writable as a file"),
        FileServiceError::NotAFile(path) if path.is_empty()
    ));
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("root cannot be created"),
        FileServiceError::InvalidCreateRequest(message) if message == "path is required"
    ));
    assert!(matches!(
        WorkspaceFilesService::rename_entry(dir.path(), "", "renamed")
            .expect_err("root cannot be renamed"),
        FileServiceError::InvalidRenameRequest(_)
    ));
    assert!(matches!(
        WorkspaceFilesService::delete_entry(dir.path(), "").expect_err("root cannot be deleted"),
        FileServiceError::InvalidDeleteRequest(_)
    ));
}

#[test]
fn ordinary_missing_paths_keep_operation_specific_behavior() {
    let dir = TestWorkspace::new();

    assert!(matches!(
        WorkspaceFilesService::stat_file(dir.path(), "missing.txt").expect_err("missing stat"),
        FileServiceError::NotFound(path) if path == "missing.txt"
    ));
    assert!(matches!(
        WorkspaceFilesService::read_file(dir.path(), "missing.txt").expect_err("missing read"),
        FileServiceError::NotFound(path) if path == "missing.txt"
    ));
    assert!(matches!(
        WorkspaceFilesService::list_entries(dir.path(), "missing").expect_err("missing list"),
        FileServiceError::NotFound(path) if path == "missing"
    ));
    assert!(matches!(
        WorkspaceFilesService::rename_entry(dir.path(), "missing.txt", "renamed.txt")
            .expect_err("missing rename"),
        FileServiceError::NotFound(path) if path == "missing.txt"
    ));
    assert!(matches!(
        WorkspaceFilesService::delete_entry(dir.path(), "missing.txt")
            .expect_err("missing delete"),
        FileServiceError::NotFound(path) if path == "missing.txt"
    ));

    let written = WorkspaceFilesService::write_file(dir.path(), "missing.txt", "created", "")
        .expect("compatibility write creates a normal missing file");
    assert_eq!(written.path, "missing.txt");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("missing.txt")).expect("read upserted file"),
        "created"
    );
}

#[test]
fn unsafe_public_paths_are_rejected_before_filesystem_access() {
    let dir = TestWorkspace::new();

    let cases = [
        ("/tmp/file", SafetyError::AbsolutePath),
        ("../file", SafetyError::TraversalAttempt),
        (".git/config", SafetyError::GitDirectory),
    ];
    for (path, expected) in cases {
        let error = WorkspaceFilesService::stat_file(dir.path(), path)
            .expect_err("unsafe path should be rejected");
        assert!(matches!(error, FileServiceError::Safety(actual) if actual == expected));
    }
}

#[test]
fn io_classifier_keeps_missing_permission_and_unexpected_distinct() {
    let missing = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::NotFound),
        "missing.txt",
    );
    let denied = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::PermissionDenied),
        "secret.txt",
    );
    let unexpected = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::Other),
        "seeded/private/path.txt",
    );

    assert!(matches!(missing, FileServiceError::NotFound(path) if path == "missing.txt"));
    assert!(matches!(denied, FileServiceError::PermissionDenied));
    assert!(matches!(unexpected, FileServiceError::Io));
    assert_eq!(unexpected.to_string(), "file operation failed");
}

#[cfg(unix)]
#[test]
fn contained_file_symlink_operations_follow_target_except_entry_mutations() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("target.txt"), "before").expect("seed target");
    std::os::unix::fs::symlink("target.txt", dir.path().join("link.txt"))
        .expect("seed file symlink");

    let parent = WorkspaceFilesService::list_entries(dir.path(), "").expect("list parent");
    let row = parent
        .entries
        .iter()
        .find(|entry| entry.path == "link.txt")
        .expect("link row");
    assert_eq!(row.kind, WorkspaceFileKind::Symlink);
    assert_eq!(row.has_children, None);
    assert_eq!(row.size_bytes, None);
    assert_eq!(row.is_text, None);

    let stat = WorkspaceFilesService::stat_file(dir.path(), "link.txt").expect("stat link target");
    assert_eq!(stat.kind, WorkspaceFileKind::File);
    assert_eq!(stat.size_bytes, Some(6));
    let read = WorkspaceFilesService::read_file(dir.path(), "link.txt").expect("read link target");
    assert_eq!(read.content.as_deref(), Some("before"));
    assert!(matches!(
        WorkspaceFilesService::list_entries(dir.path(), "link.txt")
            .expect_err("file link is not a directory"),
        FileServiceError::NotADirectory(path) if path == "link.txt"
    ));

    WorkspaceFilesService::write_file(
        dir.path(),
        "link.txt",
        "after",
        read.version_token.as_deref().expect("version token"),
    )
    .expect("write through contained link");
    assert!(dir
        .path()
        .join("link.txt")
        .symlink_metadata()
        .expect("link remains")
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("target.txt")).expect("updated target"),
        "after"
    );
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "link.txt",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("occupied link cannot be created"),
        FileServiceError::AlreadyExists(path) if path == "link.txt"
    ));
}

#[cfg(unix)]
#[test]
fn contained_directory_symlink_direct_list_uses_requested_prefix() {
    let dir = TestWorkspace::new();
    std::fs::create_dir_all(dir.path().join("target-dir/nested")).expect("seed target dir");
    std::fs::write(dir.path().join("target-dir/child.txt"), "child").expect("seed child");
    std::os::unix::fs::symlink("target-dir", dir.path().join("dir-link"))
        .expect("seed directory symlink");

    let stat = WorkspaceFilesService::stat_file(dir.path(), "dir-link").expect("stat dir link");
    assert_eq!(stat.kind, WorkspaceFileKind::Directory);
    assert!(matches!(
        WorkspaceFilesService::read_file(dir.path(), "dir-link")
            .expect_err("directory link is not a file"),
        FileServiceError::NotAFile(path) if path == "dir-link"
    ));
    assert!(matches!(
        WorkspaceFilesService::write_file(dir.path(), "dir-link", "nope", "")
            .expect_err("directory link is not writable as a file"),
        FileServiceError::NotAFile(path) if path == "dir-link"
    ));

    let listing =
        WorkspaceFilesService::list_entries(dir.path(), "dir-link").expect("list directory target");
    assert_eq!(listing.directory_path, "dir-link");
    assert!(listing
        .entries
        .iter()
        .all(|entry| entry.path.starts_with("dir-link/")));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path == "dir-link/child.txt"));
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "dir-link",
            CreateWorkspaceFileEntryKind::Directory,
            None,
        )
        .expect_err("occupied directory link cannot be created"),
        FileServiceError::AlreadyExists(path) if path == "dir-link"
    ));
}

#[cfg(unix)]
#[test]
fn dangling_symlink_is_missing_for_target_operations_but_occupied_for_create() {
    let dir = TestWorkspace::new();
    std::os::unix::fs::symlink("missing-target", dir.path().join("dangling"))
        .expect("seed dangling link");

    let parent = WorkspaceFilesService::list_entries(dir.path(), "").expect("list parent");
    let row = parent
        .entries
        .iter()
        .find(|entry| entry.path == "dangling")
        .expect("dangling row");
    assert_eq!(row.kind, WorkspaceFileKind::Symlink);
    assert_eq!(row.has_children, None);
    assert_eq!(row.size_bytes, None);

    for error in [
        WorkspaceFilesService::stat_file(dir.path(), "dangling").expect_err("dangling stat"),
        WorkspaceFilesService::read_file(dir.path(), "dangling").expect_err("dangling read"),
        WorkspaceFilesService::list_entries(dir.path(), "dangling").expect_err("dangling list"),
        WorkspaceFilesService::write_file(dir.path(), "dangling", "nope", "")
            .expect_err("dangling write"),
    ] {
        assert!(matches!(error, FileServiceError::NotFound(path) if path == "dangling"));
    }
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "dangling",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("dangling link occupies its entry"),
        FileServiceError::AlreadyExists(path) if path == "dangling"
    ));
    assert!(dir.path().join("dangling").symlink_metadata().is_ok());

    let renamed = WorkspaceFilesService::rename_entry(dir.path(), "dangling", "renamed-link")
        .expect("rename dangling link");
    assert_eq!(renamed.entry.kind, WorkspaceFileKind::Symlink);
    let deleted = WorkspaceFilesService::delete_entry(dir.path(), "renamed-link")
        .expect("delete dangling link");
    assert_eq!(deleted.kind, WorkspaceFileKind::Symlink);
}

#[cfg(unix)]
#[test]
fn external_symlink_is_listed_but_target_operations_are_refused() {
    let dir = TestWorkspace::new();
    let external = std::env::temp_dir().join(format!(
        "anyharness-files-external-target-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&external, "outside").expect("seed external target");
    std::os::unix::fs::symlink(&external, dir.path().join("external-link"))
        .expect("seed external link");

    let row = WorkspaceFilesService::list_entries(dir.path(), "")
        .expect("list parent")
        .entries
        .into_iter()
        .find(|entry| entry.path == "external-link")
        .expect("external link row");
    assert_eq!(row.kind, WorkspaceFileKind::Symlink);
    assert_eq!(row.has_children, None);
    assert_eq!(row.size_bytes, None);

    for error in [
        WorkspaceFilesService::stat_file(dir.path(), "external-link").expect_err("external stat"),
        WorkspaceFilesService::read_file(dir.path(), "external-link").expect_err("external read"),
        WorkspaceFilesService::list_entries(dir.path(), "external-link")
            .expect_err("external list"),
        WorkspaceFilesService::write_file(dir.path(), "external-link", "nope", "")
            .expect_err("external write"),
    ] {
        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::OutsideWorkspace)
        ));
    }
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "external-link",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("external link occupies entry"),
        FileServiceError::AlreadyExists(path) if path == "external-link"
    ));

    WorkspaceFilesService::rename_entry(dir.path(), "external-link", "renamed-external")
        .expect("rename external link entry");
    WorkspaceFilesService::delete_entry(dir.path(), "renamed-external")
        .expect("delete external link entry");
    assert_eq!(
        std::fs::read_to_string(&external).expect("external target preserved"),
        "outside"
    );
    let _ = std::fs::remove_file(external);
}

#[cfg(unix)]
#[test]
fn git_symlink_is_listed_but_target_operations_are_refused() {
    let dir = TestWorkspace::new();
    std::fs::create_dir(dir.path().join(".git")).expect("seed git dir");
    std::fs::write(dir.path().join(".git/config"), "secret").expect("seed git file");
    std::os::unix::fs::symlink(".git", dir.path().join("git-link")).expect("seed git link");

    let row = WorkspaceFilesService::list_entries(dir.path(), "")
        .expect("list parent")
        .entries
        .into_iter()
        .find(|entry| entry.path == "git-link")
        .expect("git link row");
    assert_eq!(row.kind, WorkspaceFileKind::Symlink);
    assert_eq!(row.has_children, None);
    assert_eq!(row.size_bytes, None);

    for error in [
        WorkspaceFilesService::stat_file(dir.path(), "git-link").expect_err("git-link stat"),
        WorkspaceFilesService::read_file(dir.path(), "git-link").expect_err("git-link read"),
        WorkspaceFilesService::list_entries(dir.path(), "git-link").expect_err("git-link list"),
        WorkspaceFilesService::write_file(dir.path(), "git-link", "nope", "")
            .expect_err("git-link write"),
    ] {
        assert!(matches!(
            error,
            FileServiceError::Safety(SafetyError::GitDirectory)
        ));
    }
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "git-link",
            CreateWorkspaceFileEntryKind::Directory,
            None,
        )
        .expect_err("git link occupies entry"),
        FileServiceError::AlreadyExists(path) if path == "git-link"
    ));

    WorkspaceFilesService::rename_entry(dir.path(), "git-link", "renamed-git-link")
        .expect("rename git link entry");
    WorkspaceFilesService::delete_entry(dir.path(), "renamed-git-link")
        .expect("delete git link entry");
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".git/config")).expect("git target preserved"),
        "secret"
    );
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
