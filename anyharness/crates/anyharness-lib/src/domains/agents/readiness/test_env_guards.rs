//! Process-environment guards shared by the readiness test modules, plus the
//! lock that makes them safe.
//!
//! `PATH`, `HOME`, and the `ANYHARNESS_*_AGENT_PROGRAM` overrides are
//! process-global, and readiness deliberately reads all three. Two tests
//! mutating them concurrently under `cargo test`'s thread pool observe each
//! other — including one's guard restoring a value mid-assertion in the other —
//! so every test that constructs a guard here takes [`lock_env`] first, for its
//! whole body.
//!
//! The lock is the crate-wide `app::test_support::ENV_MUTEX`, not a module-local
//! one: narrowing `PATH` to a temp dir also breaks any OTHER test in the crate
//! that shells out (the installer's `git`/`npm` invocations, for instance), so
//! the mutual exclusion has to be crate-wide to be true.
//!
//! `#[path]`-included into `service_tests.rs`, whose nested submodules reach
//! these through `use super::*`.

use std::path::Path;

pub(super) struct PathEnvGuard {
    original: Option<std::ffi::OsString>,
}

impl PathEnvGuard {
    pub(super) fn set(path: &Path) -> Self {
        let original = std::env::var_os("PATH");
        let paths = vec![path.to_path_buf()];
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

pub(super) use crate::app::test_support::lock_env_blocking;

pub(super) struct EnvVarGuard {
    name: &'static str,
    original: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    pub(super) fn set(name: &'static str, value: &Path) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    pub(super) fn set_str(name: &'static str, value: &str) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    /// Remove a var for the guard's lifetime (restored on drop). Used to
    /// neutralize an ambient provider key so credential detection is
    /// deterministic regardless of the host's environment.
    pub(super) fn remove(name: &'static str) -> Self {
        let original = std::env::var_os(name);
        std::env::remove_var(name);
        Self { name, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            std::env::set_var(self.name, original);
        } else {
            std::env::remove_var(self.name);
        }
    }
}
