//! The auto-install decision matrix. Pure inputs, so this enumerates the whole
//! product rather than the cells that happened to bite us. R2.0 retired the
//! PATH carve-out from the always-managed policy; the PATH column below
//! covers both that (installs now) and the legacy escape hatch (still skips).

use std::sync::Mutex;

use super::*;
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::runtime::RuntimeSurface;

/// `ANYHARNESS_ALWAYS_MANAGED_INSTALL` is process-global; serialize the one
/// test that mutates it against parallel test-thread execution.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn facts(has_path_artifact: bool, has_managed_artifact: bool) -> AgentInstallFacts {
    AgentInstallFacts {
        has_path_artifact,
        has_managed_artifact,
    }
}

const ABSENT: AgentInstallFacts = AgentInstallFacts {
    has_path_artifact: false,
    has_managed_artifact: false,
};
const PATH_ONLY: AgentInstallFacts = AgentInstallFacts {
    has_path_artifact: true,
    has_managed_artifact: false,
};
const MANAGED_ONLY: AgentInstallFacts = AgentInstallFacts {
    has_path_artifact: false,
    has_managed_artifact: true,
};
const BOTH: AgentInstallFacts = AgentInstallFacts {
    has_path_artifact: true,
    has_managed_artifact: true,
};

/// The law: an absent supported agent installs, on every surface, with no user
/// action. This is what `installed_only` used to forbid — an absent opencode or
/// grok stayed `InstallRequired` until someone clicked install, and session
/// create then rejected the harness rather than converging it.
#[test]
fn an_absent_agent_auto_installs_on_a_full_pass() {
    for surface in [RuntimeSurface::Local, RuntimeSurface::Cloud] {
        for kind in [
            AgentKind::Claude,
            AgentKind::Codex,
            AgentKind::OpenCode,
            AgentKind::Grok,
        ] {
            assert_eq!(
                auto_install_decision(&kind, surface, false, ABSENT),
                Ok(()),
                "{kind:?} on {surface:?} must auto-install when absent"
            );
        }
    }
}

/// R2.0 (RULED): a user's own binary on PATH no longer blocks a managed
/// install — it installs alongside it, on every surface and scope (cursor in
/// cloud is still the one carve-out, tested separately below).
#[test]
fn a_path_provided_agent_now_installs_alongside_it() {
    for surface in [RuntimeSurface::Local, RuntimeSurface::Cloud] {
        for kind in [
            AgentKind::Claude,
            AgentKind::Codex,
            AgentKind::OpenCode,
            AgentKind::Grok,
        ] {
            assert_eq!(
                auto_install_decision(&kind, surface, false, PATH_ONLY),
                Ok(()),
                "{kind:?} on {surface:?} must install even though a PATH copy exists"
            );
        }
    }
}

/// `installed_only` still respects a path-only agent as "not managed": it has
/// no managed artifact yet, so a scoped pass leaves it for the next full pass.
#[test]
fn installed_only_still_skips_a_path_only_agent_as_unmanaged() {
    assert_eq!(
        auto_install_decision(&AgentKind::Codex, RuntimeSurface::Local, true, PATH_ONLY),
        Err(AutoInstallSkip::NotManagedInInstalledOnlyPass)
    );
}

/// Cursor-in-cloud is the one remaining carve-out and still outranks nothing
/// else — it is the highest-precedence check now that the PATH carve-out is
/// retired from the decision path.
#[test]
fn cursor_in_cloud_still_skips_even_with_a_path_copy() {
    assert_eq!(
        auto_install_decision(&AgentKind::Cursor, RuntimeSurface::Cloud, true, PATH_ONLY),
        Err(AutoInstallSkip::CursorUnsupportedInCloud)
    );
}

/// The legacy escape hatch (`ANYHARNESS_ALWAYS_MANAGED_INSTALL=off`) restores
/// the pre-R2.0 PATH carve-out through the escape-hatch entry point, without
/// touching the always-managed predicate under test above. Guarded by a
/// mutex: env vars are process-global and tests run in parallel.
#[test]
fn escape_hatch_restores_the_legacy_path_carve_out() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("ANYHARNESS_ALWAYS_MANAGED_INSTALL", "off");
    assert_eq!(
        auto_install_decision_with_escape_hatch(
            &AgentKind::Codex,
            RuntimeSurface::Local,
            false,
            PATH_ONLY
        ),
        Err(AutoInstallSkip::UserProvidedOnPath),
        "off must restore the pre-R2.0 skip"
    );
    std::env::remove_var("ANYHARNESS_ALWAYS_MANAGED_INSTALL");
    assert_eq!(
        auto_install_decision_with_escape_hatch(
            &AgentKind::Codex,
            RuntimeSurface::Local,
            false,
            PATH_ONLY
        ),
        Ok(()),
        "unset (default) must be the always-managed policy"
    );
}

/// A machine with BOTH a managed copy and a PATH copy keeps converging the
/// managed one. Skipping it would strand our own install at an old pin forever,
/// and we are not shadowing anything the user owns — we already installed
/// alongside it.
#[test]
fn a_managed_copy_keeps_converging_even_beside_a_path_copy() {
    for installed_only in [true, false] {
        assert_eq!(
            auto_install_decision(
                &AgentKind::Codex,
                RuntimeSurface::Local,
                installed_only,
                BOTH
            ),
            Ok(())
        );
    }
}

/// Cursor in cloud: login-only, no headless credential path, so an install could
/// never reach `Ready` and doing it is pure download cost.
#[test]
fn cursor_does_not_install_in_cloud_but_does_locally() {
    assert_eq!(
        auto_install_decision(&AgentKind::Cursor, RuntimeSurface::Cloud, false, ABSENT),
        Err(AutoInstallSkip::CursorUnsupportedInCloud)
    );
    assert_eq!(
        auto_install_decision(&AgentKind::Cursor, RuntimeSurface::Local, false, ABSENT),
        Ok(()),
        "cursor auto-installs locally — the carve-out is cloud-only"
    );
}

/// The cloud carve-out is cursor-specific: no other harness is suppressed there.
#[test]
fn no_other_harness_is_suppressed_in_cloud() {
    for kind in [
        AgentKind::Claude,
        AgentKind::Codex,
        AgentKind::OpenCode,
        AgentKind::Grok,
    ] {
        assert_eq!(
            auto_install_decision(&kind, RuntimeSurface::Cloud, false, ABSENT),
            Ok(()),
            "{kind:?} must still auto-install in cloud"
        );
    }
}

/// `installed_only` survives as the SCOPED action (settings' "update installed
/// agents"), and there it still means what it says: touch what we manage, skip
/// what we do not. It is simply no longer what the startup pass uses.
#[test]
fn an_installed_only_pass_still_updates_only_managed_installs() {
    assert_eq!(
        auto_install_decision(&AgentKind::OpenCode, RuntimeSurface::Local, true, ABSENT),
        Err(AutoInstallSkip::NotManagedInInstalledOnlyPass)
    );
    assert_eq!(
        auto_install_decision(
            &AgentKind::OpenCode,
            RuntimeSurface::Local,
            true,
            MANAGED_ONLY
        ),
        Ok(())
    );
}

/// A managed-installed agent converges in both scopes — the drift planner, not
/// this predicate, then decides whether any work is actually needed.
#[test]
fn a_managed_agent_converges_in_either_scope() {
    for installed_only in [true, false] {
        assert_eq!(
            auto_install_decision(
                &AgentKind::Claude,
                RuntimeSurface::Local,
                installed_only,
                MANAGED_ONLY
            ),
            Ok(())
        );
    }
}

/// Skip messages are distinct and non-empty: the Tier-3 agent-lifecycle scenario
/// asserts on the PATH message, so it is a contract rather than a log string.
#[test]
fn every_skip_reason_has_a_distinct_message() {
    let messages = [
        AutoInstallSkip::UserProvidedOnPath.message(),
        AutoInstallSkip::CursorUnsupportedInCloud.message(),
        AutoInstallSkip::NotManagedInInstalledOnlyPass.message(),
    ];
    let distinct: std::collections::BTreeSet<_> = messages.iter().collect();
    assert_eq!(distinct.len(), messages.len());
    assert!(messages.iter().all(|message| !message.is_empty()));
    assert!(AutoInstallSkip::UserProvidedOnPath.message().contains("PATH"));
}

/// Sanity: the `facts` helper and the consts agree, so a future reader editing
/// one cannot silently desync the matrix above.
#[test]
fn fact_constants_match_their_constructor() {
    assert_eq!(facts(false, false), ABSENT);
    assert_eq!(facts(true, false), PATH_ONLY);
    assert_eq!(facts(false, true), MANAGED_ONLY);
    assert_eq!(facts(true, true), BOTH);
}
