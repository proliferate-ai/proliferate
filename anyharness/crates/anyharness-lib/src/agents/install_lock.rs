use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

use fs2::FileExt;

use super::model::AgentKind;

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
