use super::safety::SafetyError;
use super::service::{FileServiceError, WorkspaceFilesService};
use super::service_test_support::TestWorkspace;
use super::types::{CreateWorkspaceFileEntryKind, WorkspaceFileKind};

#[test]
fn regular_file_ancestor_is_not_a_directory_for_file_operations() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("parent-file"), "parent").expect("seed file ancestor");
    let nested_path = "parent-file/missing/child.txt";

    assert!(matches!(
        WorkspaceFilesService::stat_file(dir.path(), nested_path)
            .expect_err("stat below a file ancestor"),
        FileServiceError::NotADirectory(path) if path == nested_path
    ));
    assert!(matches!(
        WorkspaceFilesService::read_file(dir.path(), nested_path)
            .expect_err("read below a file ancestor"),
        FileServiceError::NotADirectory(path) if path == nested_path
    ));
    assert!(matches!(
        WorkspaceFilesService::list_entries(dir.path(), nested_path)
            .expect_err("list below a file ancestor"),
        FileServiceError::NotADirectory(path) if path == nested_path
    ));
    assert!(matches!(
        WorkspaceFilesService::write_file(dir.path(), nested_path, "nope", "")
            .expect_err("write below a file ancestor"),
        FileServiceError::NotADirectory(path) if path == nested_path
    ));
    assert!(matches!(
        WorkspaceFilesService::rename_entry(dir.path(), nested_path, "renamed.txt")
            .expect_err("rename below a file ancestor"),
        FileServiceError::NotADirectory(path) if path == nested_path
    ));
    assert!(matches!(
        WorkspaceFilesService::delete_entry(dir.path(), nested_path)
            .expect_err("delete below a file ancestor"),
        FileServiceError::NotADirectory(path) if path == nested_path
    ));
    assert_eq!(
        std::fs::read_to_string(dir.path().join("parent-file")).expect("ancestor remains"),
        "parent"
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
fn git_named_workspace_ancestor_does_not_poison_contained_paths() {
    let outer = std::env::temp_dir().join(format!(
        "anyharness-files-git-ancestor-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = outer.join(".git/workspace");
    std::fs::create_dir_all(&workspace).expect("seed workspace under .git-named ancestor");
    std::fs::write(workspace.join("inside.txt"), "inside").expect("seed contained file");

    let stat = WorkspaceFilesService::stat_file(&workspace, "inside.txt")
        .expect("contained path remains valid");
    assert_eq!(stat.kind, WorkspaceFileKind::File);

    let _ = std::fs::remove_dir_all(outer);
}

#[test]
fn io_classifier_keeps_missing_wrong_kind_permission_and_unexpected_distinct() {
    let missing = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::NotFound),
        "missing.txt",
    );
    let denied = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::PermissionDenied),
        "secret.txt",
    );
    let not_a_directory = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::NotADirectory),
        "parent-file/missing/child.txt",
    );
    let unexpected = FileServiceError::from_io(
        std::io::Error::from(std::io::ErrorKind::Other),
        "seeded/private/path.txt",
    );

    assert!(matches!(missing, FileServiceError::NotFound(path) if path == "missing.txt"));
    assert!(matches!(
        not_a_directory,
        FileServiceError::NotADirectory(path) if path == "parent-file/missing/child.txt"
    ));
    assert!(matches!(denied, FileServiceError::PermissionDenied));
    assert!(matches!(unexpected, FileServiceError::Io));
    assert_eq!(unexpected.to_string(), "file operation failed");

    assert!(matches!(
        FileServiceError::from_safety(
            SafetyError::NotADirectory,
            "parent-file/missing/child.txt"
        ),
        FileServiceError::NotADirectory(path) if path == "parent-file/missing/child.txt"
    ));
    assert!(matches!(
        FileServiceError::from_safety(SafetyError::PermissionDenied, "secret.txt"),
        FileServiceError::PermissionDenied
    ));
    assert!(matches!(
        FileServiceError::from_safety(SafetyError::IoError, "seeded/private/path.txt"),
        FileServiceError::Io
    ));
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
fn symlink_target_below_regular_file_is_still_dangling() {
    let dir = TestWorkspace::new();
    std::fs::write(dir.path().join("target-file"), "target").expect("seed target file");
    std::os::unix::fs::symlink(
        "target-file/missing",
        dir.path().join("dangling-through-file"),
    )
    .expect("seed dangling link through file");

    for error in [
        WorkspaceFilesService::stat_file(dir.path(), "dangling-through-file")
            .expect_err("dangling stat"),
        WorkspaceFilesService::read_file(dir.path(), "dangling-through-file")
            .expect_err("dangling read"),
        WorkspaceFilesService::list_entries(dir.path(), "dangling-through-file")
            .expect_err("dangling list"),
        WorkspaceFilesService::write_file(dir.path(), "dangling-through-file", "nope", "")
            .expect_err("dangling write"),
    ] {
        assert!(matches!(
            error,
            FileServiceError::NotFound(path) if path == "dangling-through-file"
        ));
    }
    assert!(matches!(
        WorkspaceFilesService::create_entry(
            dir.path(),
            "dangling-through-file",
            CreateWorkspaceFileEntryKind::File,
            None,
        )
        .expect_err("dangling link occupies its entry"),
        FileServiceError::AlreadyExists(path) if path == "dangling-through-file"
    ));
    assert!(dir
        .path()
        .join("dangling-through-file")
        .symlink_metadata()
        .expect("link remains")
        .file_type()
        .is_symlink());
}

#[cfg(unix)]
#[test]
fn external_symlink_is_listed_but_target_operations_are_refused() {
    let dir = TestWorkspace::new();
    let external_root = std::env::temp_dir().join(format!(
        "anyharness-files-external-root-{}",
        uuid::Uuid::new_v4()
    ));
    let external = external_root.join(".git/target.txt");
    std::fs::create_dir_all(external.parent().expect("external parent"))
        .expect("seed external parent");
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
        .expect_err("external link target is refused"),
        FileServiceError::Safety(SafetyError::OutsideWorkspace)
    ));

    WorkspaceFilesService::rename_entry(dir.path(), "external-link", "renamed-external")
        .expect("rename external link entry");
    WorkspaceFilesService::delete_entry(dir.path(), "renamed-external")
        .expect("delete external link entry");
    assert_eq!(
        std::fs::read_to_string(&external).expect("external target preserved"),
        "outside"
    );
    let _ = std::fs::remove_dir_all(external_root);
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
        .expect_err("git link target is refused"),
        FileServiceError::Safety(SafetyError::GitDirectory)
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
