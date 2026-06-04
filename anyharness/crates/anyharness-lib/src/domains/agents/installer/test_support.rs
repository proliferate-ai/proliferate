use std::path::Path;

pub(super) struct PathEnvGuard {
    original: Option<std::ffi::OsString>,
}

impl PathEnvGuard {
    pub(super) fn prepend(path: &Path) -> Self {
        let original = std::env::var_os("PATH");
        let mut paths = vec![path.to_path_buf()];
        if let Some(original_path) = &original {
            paths.extend(std::env::split_paths(original_path));
        }
        let joined = std::env::join_paths(paths).expect("join PATH");
        std::env::set_var("PATH", joined);
        Self { original }
    }
}

impl Drop for PathEnvGuard {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            std::env::set_var("PATH", original);
        } else {
            std::env::remove_var("PATH");
        }
    }
}
