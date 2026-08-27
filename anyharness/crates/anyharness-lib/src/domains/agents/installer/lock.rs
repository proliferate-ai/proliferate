use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

use fs2::FileExt;

use crate::domains::agents::model::AgentKind;

pub struct AgentInstallLock {
    _file: File,
    path: PathBuf,
}

impl AgentInstallLock {
    pub fn acquire_agent(runtime_home: &Path, kind: &AgentKind) -> std::io::Result<Self> {
        let dir = runtime_home.join("agents").join(kind.as_str());
        std::fs::create_dir_all(&dir)?;
        Self::acquire(dir.join(".install.lock"))
    }

    pub fn acquire_node(runtime_home: &Path) -> std::io::Result<Self> {
        let dir = runtime_home.join("node");
        std::fs::create_dir_all(&dir)?;
        Self::acquire(dir.join(".install.lock"))
    }

    fn acquire(path: PathBuf) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            // Lock files are contended by design; never truncate — another
            // holder may have the file open, and the byte content is unused.
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)?;
        file.lock_exclusive()?;
        Ok(Self { _file: file, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for AgentInstallLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}
