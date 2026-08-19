use std::path::{Path, PathBuf};
pub(super) struct TestWorkspace {
    path: PathBuf,
}

impl TestWorkspace {
    pub(super) fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("anyharness-files-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).expect("create temp workspace");
        Self { path }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
