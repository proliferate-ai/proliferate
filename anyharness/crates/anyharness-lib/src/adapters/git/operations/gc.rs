//! Purge's guarded `git gc`. New in R5: nothing before purge ever ran a gc
//! on a live workspace's repo root, so there was no guard to get wrong.
//!
//! Two literal-string guards, both load-bearing:
//!
//! - `-c gc.worktreePruneExpire=never` as a CLI arg (not a config file write):
//!   a bare `git gc` also prunes worktree administrative files older than its
//!   default expiry, and a sibling workspace's worktree registration is
//!   exactly the kind of "administrative file" a repo-wide gc can see. This
//!   flag turns worktree pruning off for the duration of this one gc call
//!   without touching the repo's persistent config.
//! - `--prune=1.hour.ago`, spelled out in full: git's date parser accepts the
//!   abbreviation `1.h.ago`, but silently reinterprets it as roughly 11 days
//!   (`h` is not a recognized unit in that grammar; the parser falls through
//!   to a much longer default window). The abbreviated form still LOOKS
//!   correct in a diff, which is exactly why it must never be typed here even
//!   as a "shorter" edit.
//!
//! Never `--prune=now`: an in-progress `git worktree add`/`remove` elsewhere
//! in the same repo root can have loose objects that are only reachable from
//! a not-yet-linked ref for a few seconds, and `now` reclaims them out from
//! under it. `1.hour.ago` gives every such window room to close.

use std::path::Path;
use std::process::Command;

/// The exact argv `gc_repo` invokes, factored out as the observation seam the
/// spec asks for ("assert the argv in a test - it is cheap insurance against a
/// future tidy-up"). `gc_repo` builds and spawns its `Command` inline, so
/// without this constant there is nothing for a test to read but the source
/// text.
pub(super) const GC_ARGV: [&str; 4] = [
    "-c",
    "gc.worktreePruneExpire=never",
    "gc",
    "--prune=1.hour.ago",
];

pub fn gc_repo(repo_root: &Path) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(GC_ARGV)
        .current_dir(repo_root)
        .output()
        .map_err(|error| anyhow::anyhow!("git gc failed to run: {error}"))?;
    if !output.status.success() {
        anyhow::bail!(
            "git gc failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    use uuid::Uuid;

    use super::{gc_repo, GC_ARGV};

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("anyharness-gc-{prefix}-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn run(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_repo(path: &Path) {
        run(path, &["init", "-b", "main"]);
        run(path, &["config", "user.email", "test@example.com"]);
        run(path, &["config", "user.name", "Test"]);
        run(path, &["config", "commit.gpgsign", "false"]);
        fs::write(path.join("README.md"), "seed\n").expect("write seed");
        run(path, &["add", "README.md"]);
        run(path, &["commit", "-m", "initial"]);
    }

    /// A loose, freshly written, wholly unreachable blob: nothing references
    /// it, and its mtime is now.
    fn write_unreachable_blob(repo: &Path, content: &str) -> String {
        let mut child = Command::new("git")
            .args(["hash-object", "-w", "--stdin"])
            .current_dir(repo)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn git hash-object");
        child
            .stdin
            .take()
            .expect("hash-object stdin")
            .write_all(content.as_bytes())
            .expect("write blob content");
        let output = child.wait_with_output().expect("git hash-object");
        assert!(output.status.success(), "hash-object failed");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn object_exists(repo: &Path, oid: &str) -> bool {
        Command::new("git")
            .args(["cat-file", "-e", oid])
            .current_dir(repo)
            .output()
            .expect("spawn git cat-file")
            .status
            .success()
    }

    #[test]
    fn the_gc_invocation_spells_the_prune_window_out_and_disables_worktree_pruning() {
        // The spec's own cheap insurance: pin the argv, not the source text.
        // `1.h.ago` PARSES — as roughly eleven days — so an abbreviation would
        // pass every behavioral test that only proves "older objects go", and
        // `--prune=now` would pass every test that only proves "unreachable
        // objects go". Only the literal invocation distinguishes them.
        assert_eq!(
            GC_ARGV,
            [
                "-c",
                "gc.worktreePruneExpire=never",
                "gc",
                "--prune=1.hour.ago",
            ]
        );
    }

    #[test]
    fn an_object_written_moments_ago_survives_the_gc() {
        // The behavioral negative control for `--prune=now`: an in-progress
        // `git worktree add`/`remove` elsewhere in the repo can have loose
        // objects reachable only from a not-yet-linked ref for a few seconds,
        // and `now` reclaims them out from under it. Swap the window to
        // `--prune=now` and this test fails — the blob is gone. `cat-file -e`
        // rather than a loose-object stat, because a modern gc may relocate an
        // unreachable object into a cruft pack instead of deleting it, and
        // "still in the repository" is what the guard is actually about.
        let repo = TempDirGuard::new("prune-window");
        init_repo(repo.path());
        let blob = write_unreachable_blob(repo.path(), "reachable from nothing at all\n");
        assert!(object_exists(repo.path(), &blob));

        gc_repo(repo.path()).expect("gc_repo");

        assert!(
            object_exists(repo.path(), &blob),
            "an unreachable object younger than the prune window must survive the gc"
        );
    }

    #[test]
    fn a_sibling_worktree_registration_survives_a_gc_even_under_a_hostile_repo_config() {
        // The behavioral negative control for `-c gc.worktreePruneExpire=never`:
        // `git gc` internally runs the repo-global `worktree prune` this design
        // bans everywhere else, and a user's OWN gitconfig can arm it against a
        // sibling workspace's mid-choreography registration. The fixture writes
        // exactly that hostile config, so dropping the `-c` flag makes this
        // test fail — the registration is pruned.
        let repo = TempDirGuard::new("worktree-prune-expiry");
        init_repo(repo.path());
        let sibling = repo.path().join("sibling-checkout");
        let sibling_string = sibling.display().to_string();
        run(
            repo.path(),
            &["worktree", "add", "-b", "sibling", &sibling_string, "HEAD"],
        );
        let registration = repo
            .path()
            .join(".git")
            .join("worktrees")
            .join("sibling-checkout");
        assert!(registration.exists(), "fixture must register the sibling");
        // The mid-choreography shape: the checkout is momentarily absent while
        // its registration is still live, which is what makes it prunable.
        fs::remove_dir_all(&sibling).expect("remove the sibling checkout");
        run(repo.path(), &["config", "gc.worktreePruneExpire", "now"]);

        gc_repo(repo.path()).expect("gc_repo");

        assert!(
            registration.exists(),
            "the CLI -c flag must override a hostile repo config; a sibling's \
             worktree registration is never this gc's to prune"
        );
    }
}
