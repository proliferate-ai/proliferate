//! Should this reconcile pass install this agent? The pure decision.
//!
//! agent-distribution.md, "Installation":
//!
//! > Installation is automatic. Every harness supported on a surface converges
//! > with no user action: absent means install, drifted means reinstall, and both
//! > are the same mechanism… A user authenticates harnesses; they never install
//! > them. Two carve-outs:
//! >
//! > - An agent the user already provides on PATH is left alone: it is usable
//! >   through readiness as-is, and a managed install would shadow their copy.
//! > - Cursor never installs in cloud. It is login-only with no headless
//! >   credential path, so a cloud install could never reach `Ready`.
//!
//! The carve-outs used to be implicit in `installed_only`: because that scope
//! skipped every agent that was not already managed-installed, it skipped
//! PATH-provided agents *as a side effect* of skipping absent ones. Dropping the
//! flag to get auto-install would therefore have silently dropped the PATH
//! protection too — a managed install would land on top of a user's own binary.
//!
//! So the carve-outs move here, as one decision function with a name, per the
//! plan's requirement that auto-install ride "behind an explicit tested
//! predicate". A pure fn over facts the caller gathers: no IO, no env reads.

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::runtime::RuntimeSurface;

/// Whether an artifact the runtime can see is the USER's (on PATH) or OURS
/// (managed, installed under the runtime home).
///
/// `"path"` is the source string `readiness` stamps on a PATH-resolved artifact;
/// `"managed"` is what the installer stamps. Anything else (an override, an
/// unknown future source) is treated as not-ours-and-not-PATH: we neither claim
/// it nor protect it, and the drift planner's own idempotent checks govern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentInstallFacts {
    /// Any artifact for this agent resolves to a binary on the user's PATH.
    pub has_path_artifact: bool,
    /// Any artifact for this agent is managed-installed under the runtime home.
    pub has_managed_artifact: bool,
}

/// Why a pass is not installing an agent — carried so the reconcile result's
/// `Skipped` message names the actual reason instead of one generic string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoInstallSkip {
    /// The user provides this agent on PATH. A managed install would shadow
    /// their copy, and readiness already reports it usable.
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
///
/// Ordering is deliberate. The PATH check comes FIRST, before the surface and
/// scope checks, because it is the one carve-out that protects something the user
/// owns: no combination of scope or surface may ever result in a managed install
/// landing on top of their binary.
pub fn auto_install_decision(
    kind: &AgentKind,
    surface: RuntimeSurface,
    installed_only: bool,
    facts: AgentInstallFacts,
) -> Result<(), AutoInstallSkip> {
    // 1. The user's own binary is never touched — highest precedence.
    //
    // `has_managed_artifact` wins over `has_path_artifact` when both are true:
    // that is a machine where we already installed a managed copy AND the user
    // has one on PATH, so the managed copy is ours to keep converging. Skipping
    // it would strand it at an old pin forever.
    if facts.has_path_artifact && !facts.has_managed_artifact {
        return Err(AutoInstallSkip::UserProvidedOnPath);
    }
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

#[cfg(test)]
#[path = "auto_install_tests.rs"]
mod tests;
