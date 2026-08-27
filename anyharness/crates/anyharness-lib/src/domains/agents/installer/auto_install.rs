//! Should this reconcile pass install this agent? The pure decision.
//!
//! agent-distribution.md, "Installation":
//!
//! > Installation is automatic. Every harness supported on a surface converges
//! > with no user action: absent means install, drifted means reinstall, and both
//! > are the same mechanism… A user authenticates harnesses; they never install
//! > them. One carve-out:
//! >
//! > - Cursor never installs in cloud. It is login-only with no headless
//! >   credential path, so a cloud install could never reach `Ready`.
//!
//! R2.0 (RULED 2026-08-14): Proliferate always maintains its own managed copy,
//! even alongside a user's PATH install. The PATH carve-out that used to block
//! install here is retired from the decision path — `has_path_artifact` is now
//! a detection-only signal (surfaced to the settings-notice, see
//! product-client's HarnessPane) rather than a reason to skip. The predicate
//! stays pure (no IO, no env reads); the one legacy exception is
//! `auto_install_decision_with_escape_hatch`, which reads
//! `ANYHARNESS_ALWAYS_MANAGED_INSTALL` to restore the pre-R2.0 policy for
//! revert.
//!
//! Cursor-in-cloud used to be implicit in `installed_only` too: because that
//! scope skipped every agent that was not already managed-installed, it
//! skipped cursor as a side effect of skipping absent ones. Dropping the flag
//! to get auto-install would have silently dropped that too, so it moved here
//! as one decision function with a name, per the plan's requirement that
//! auto-install ride "behind an explicit tested predicate".

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::runtime::RuntimeSurface;

/// The two facts about an agent's present artifacts that the decision needs:
/// whether one is the USER's (on PATH) or OURS (managed, under the runtime home).
///
/// Gathered by the caller so this module stays pure. `"path"` is the source
/// string `readiness` stamps on a PATH-resolved artifact and `"managed"` is what
/// the installer stamps; anything else (an override, an unknown future source) is
/// neither, so we make no claim on it — the drift planner's own idempotent checks
/// govern that case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentInstallFacts {
    /// Any artifact for this agent resolves to a binary on the user's PATH.
    pub has_path_artifact: bool,
    /// Any artifact for this agent is managed-installed under the runtime home.
    pub has_managed_artifact: bool,
}

/// Why a pass is not installing an agent.
///
/// An enum rather than a bool-plus-string so the reconcile result's `Skipped`
/// message names the ACTUAL reason: "you provide this on PATH" and "cursor cannot
/// work in cloud" are different answers for the user, and the old
/// `installed_only` boolean collapsed both into one generic skip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoInstallSkip {
    /// Legacy-only (post-R2.0): reachable solely through
    /// `auto_install_decision_with_escape_hatch` when
    /// `ANYHARNESS_ALWAYS_MANAGED_INSTALL=off`. The always-managed policy
    /// (`auto_install_decision`) never returns this.
    UserProvidedOnPath,
    /// Cursor in cloud: login-only, no headless credential path, so an install
    /// could never reach `Ready`.
    CursorUnsupportedInCloud,
    /// An installed-only pass (the settings pane's "update installed agents"
    /// action) deliberately touching only what we already manage.
    NotManagedInInstalledOnlyPass,
}

impl AutoInstallSkip {
    /// The message surfaced on the reconcile result. Stable strings: the Tier-3
    /// agent-lifecycle scenario asserts on the PATH one.
    pub fn message(self) -> &'static str {
        match self {
            Self::UserProvidedOnPath => {
                "provided by the user on PATH; a managed install would shadow it"
            }
            Self::CursorUnsupportedInCloud => {
                "cursor is login-only and cannot reach Ready in cloud; not installed"
            }
            Self::NotManagedInInstalledOnlyPass => {
                "not managed-installed; this pass only updates managed installs"
            }
        }
    }
}

/// The decision. `Ok(())` means "reconcile this agent" (the drift planner then
/// decides whether any actual work is needed); `Err(skip)` means leave it alone.
/// Post-R2.0 the only carve-outs are cursor-in-cloud and the installed-only
/// scope; `has_path_artifact` no longer gates this at all.
pub fn auto_install_decision(
    kind: &AgentKind,
    surface: RuntimeSurface,
    installed_only: bool,
    facts: AgentInstallFacts,
) -> Result<(), AutoInstallSkip> {
    // 1. R2.0 (RULED): Proliferate always maintains its own managed copy. A
    // user's PATH artifact is a detection-only signal now — it no longer
    // blocks install. `has_path_artifact` is retained on `AgentInstallFacts`
    // for the settings-notice signal (see product-client HarnessPane) and for
    // the legacy escape hatch below, not to gate this decision.
    //
    // 2. Cursor in cloud could never reach Ready, so installing it is pure cost.
    if *kind == AgentKind::Cursor && surface == RuntimeSurface::Cloud {
        return Err(AutoInstallSkip::CursorUnsupportedInCloud);
    }
    // 3. An explicitly installed-only pass updates what we manage and nothing
    //    else. This is no longer the startup pass — it is the scoped action a
    //    user triggers from settings.
    if installed_only && !facts.has_managed_artifact {
        return Err(AutoInstallSkip::NotManagedInInstalledOnlyPass);
    }
    Ok(())
}

/// Escape hatch for R2.0: `ANYHARNESS_ALWAYS_MANAGED_INSTALL=off` restores the
/// pre-R2.0 policy (a user's PATH artifact blocks a managed install) for
/// operators who need to revert without a code change. Defaults on (the
/// ruling). A plain env read, no caching, so tests can set/unset per-case.
pub fn always_managed_install_enabled() -> bool {
    std::env::var("ANYHARNESS_ALWAYS_MANAGED_INSTALL")
        .map(|value| value != "off")
        .unwrap_or(true)
}

/// `auto_install_decision` plus the legacy escape hatch: when the flag is
/// turned off, a user's PATH artifact without a managed copy is skipped
/// exactly as it was before R2.0. Callers should use this entry point; the
/// pure predicate above stays the always-managed policy tests pin down.
pub fn auto_install_decision_with_escape_hatch(
    kind: &AgentKind,
    surface: RuntimeSurface,
    installed_only: bool,
    facts: AgentInstallFacts,
) -> Result<(), AutoInstallSkip> {
    if !always_managed_install_enabled() && facts.has_path_artifact && !facts.has_managed_artifact {
        return Err(AutoInstallSkip::UserProvidedOnPath);
    }
    auto_install_decision(kind, surface, installed_only, facts)
}

#[cfg(test)]
#[path = "auto_install_tests.rs"]
mod tests;
