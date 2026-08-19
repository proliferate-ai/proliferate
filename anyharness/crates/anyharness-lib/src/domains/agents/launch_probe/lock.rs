//! One probe engine per runtime home.
//!
//! `default_runtime_home()` is purely path-derived and `ensure_runtime_home` takes
//! no lock, so nothing stops two runtimes sharing `~/.proliferate/anyharness` — a
//! dev sidecar beside the desktop is the everyday local configuration. Two probe
//! engines over one home is the unsound case: the second's startup sweep would
//! remove the first's in-flight scratch, deleting a live probe's config dir
//! mid-spawn, and both would write the same document.
//!
//! So the engine takes a **non-blocking** exclusive advisory lock and degrades
//! rather than waits. This is the one deliberate difference from
//! `installer/lock.rs`, which blocks: an install must eventually happen, whereas
//! probing is convergence, not correctness. A runtime with no probe engine loses
//! nothing durable — a later poke on the owner restores it — while a runtime that
//! WAITED for the lock would hold a startup task forever.
//!
//! A crash releases the lock via the OS, which is why this is an flock and not a
//! pid file.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

use fs2::FileExt;

const LOCK_FILE_NAME: &str = ".probe-engine.lock";

/// Held for the process lifetime; `Drop` unlocks.
pub struct ProbeEngineLock {
    file: File,
    path: PathBuf,
}

impl ProbeEngineLock {
    /// `Some` when this process owns the probe engine for `runtime_home`; `None`
    /// when another live process holds it, or when the lock file cannot be created
    /// at all.
    ///
    /// An unopenable lock path degrades to read-only rather than panicking: a
    /// read-only runtime home is a real deployment (a sealed container image), and
    /// serving the document there is strictly better than refusing to boot.
    pub fn try_acquire(runtime_home: &Path) -> Option<Self> {
        let path = runtime_home.join(LOCK_FILE_NAME);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .map_err(|error| {
                tracing::warn!(
                    path = %path.display(),
                    %error,
                    "could not open the probe-engine lock; this runtime will not probe"
                );
            })
            .ok()?;
        match file.try_lock_exclusive() {
            Ok(()) => Some(Self { file, path }),
            Err(error) => {
                tracing::info!(
                    path = %path.display(),
                    %error,
                    "another runtime owns the probe engine for this home; running read-only"
                );
                None
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ProbeEngineLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}
