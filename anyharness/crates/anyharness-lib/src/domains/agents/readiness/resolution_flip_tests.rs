//! Rung 3 (Update Flow ADR, R2.0): resolution-flip timing.
//!
//! An in-flight session's exec path must be untouched by a reconcile that
//! installs a managed copy alongside an existing PATH copy — the flip to the
//! managed copy happens only at the NEXT session's spawn-time resolve, per
//! `agent-distribution.md`'s "next reconcile installs, next spawn resolves"
//! contract. `resolve_agent`/`resolve_agent_unrouted` are pure filesystem
//! reads with no cache, so this also proves the second half of that contract:
//! a fresh resolve after the install picks up the new managed copy with no
//! runtime restart.
//!
//! Split from `service_tests.rs` for the repo line-count ceiling; nested
//! inside it so its temp-dir/env guards are in scope.

use super::*;
use crate::domains::agents::registry::built_in_registry;
use crate::integrations::agent_cli::executable::make_executable;

/// Before R2.0 a PATH-only agent was left alone forever; now a reconcile
/// installs a managed copy alongside it. The already-resolved PATH artifact
/// (standing in for a session that spawned against it) must still be exactly
/// what it was — the managed install writes to a wholly separate directory
/// tree and never touches the user's PATH binary.
#[test]
fn a_managed_install_alongside_a_path_copy_leaves_the_path_copy_untouched() {
    let _env = lock_env();
    let registry = built_in_registry();
    let grok = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Grok)
        .expect("missing Grok descriptor");
    // Grok is registry-backed with a binary-hint fallback: the PATH probe
    // uses `candidate_binaries` and the managed probe uses the managed
    // launcher candidates, rather than a single `executable_relpath` (that
    // shape is `ManagedNpmPackage`'s, not every install spec's) — read both
    // straight off the descriptor so this test tracks whichever shape the
    // registry actually declares for grok.
    let AgentProcessInstallSpec::RegistryBacked {
        fallback: AgentProcessFallback::BinaryHint {
            candidate_binaries, ..
        },
        ..
    } = &grok.agent_process.install
    else {
        panic!(
            "expected grok to be RegistryBacked+BinaryHint, got {:?}",
            grok.agent_process.install
        );
    };
    let binary_name = candidate_binaries
        .first()
        .expect("grok must declare at least one candidate binary")
        .clone();

    let runtime_home = make_temp_dir("anyharness-resolution-flip-test");
    let path_bin_dir = make_temp_dir("anyharness-resolution-flip-path-bin");
    let path_binary = path_bin_dir.join(&binary_name);
    std::fs::write(&path_binary, "#!/bin/sh\nexit 0\n").expect("write PATH binary");
    make_executable(&path_binary).expect("make PATH binary executable");
    let _path_guard = PathEnvGuard::set(&path_bin_dir);

    // 1. Nothing managed yet: resolution reads the user's PATH copy. This is
    // the artifact an in-flight session would have spawned against.
    let before = resolve_agent_unrouted(&grok, &runtime_home);
    assert_eq!(before.agent_process.source.as_deref(), Some("path"));
    assert_eq!(
        before.agent_process.path.as_deref(),
        Some(path_binary.as_path())
    );

    // 2. A reconcile installs a managed copy alongside it (R2.0: no longer
    // skipped just because a PATH copy exists).
    let managed_dir = artifact_root(&runtime_home, &AgentKind::Grok, &ArtifactRole::AgentProcess);
    let managed_binary = managed_dir.join("grok-launcher");
    std::fs::create_dir_all(managed_binary.parent().expect("managed binary parent"))
        .expect("create managed binary dir");
    std::fs::write(&managed_binary, "#!/bin/sh\nexit 0\n").expect("write managed binary");
    make_executable(&managed_binary).expect("make managed binary executable");

    // 3. The PATH artifact an already-running session resolved against is
    // still there, still executable, byte-for-byte unchanged: the managed
    // install never touched it.
    assert!(
        path_binary.exists(),
        "the user's PATH binary must survive a managed install landing alongside it"
    );
    let path_binary_contents =
        std::fs::read_to_string(&path_binary).expect("read PATH binary after managed install");
    assert_eq!(path_binary_contents, "#!/bin/sh\nexit 0\n");

    // 4. A FRESH resolve (standing in for the next session's spawn-time
    // lookup) now picks the managed copy — no cache stood between the
    // install and the next lookup, and no runtime restart was needed.
    let after = resolve_agent_unrouted(&grok, &runtime_home);
    assert_eq!(
        after.agent_process.source.as_deref(),
        Some("managed"),
        "the next resolve must prefer the newly installed managed copy over the PATH copy"
    );
    assert_eq!(
        after.agent_process.path.as_deref(),
        Some(managed_binary.as_path())
    );

    let _ = std::fs::remove_dir_all(&runtime_home);
    let _ = std::fs::remove_dir_all(&path_bin_dir);
}
