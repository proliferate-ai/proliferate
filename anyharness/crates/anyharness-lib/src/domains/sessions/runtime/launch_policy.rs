//! Pure launch decisions for the session runtime.
//!
//! Everything here is data-in / data-out: no store, no clock, no uuid, no
//! `&self`. `startup.rs` performs the resolve steps (record loads, link
//! lookups, env/MCP assembly) and feeds the gathered facts in; this module
//! owns the decisions — which startup strategy to use, whether a launch is
//! blocked, and the final [`SessionLaunch`] shape.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::domains::agents::model::{AgentKind, ResolvedAgent};
use crate::domains::agent_auth::route_auth::RenderedRouteAuth;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::live::sessions::model::{LaunchEnv, SessionLaunch, SystemPromptAppends};
use crate::live::sessions::SessionStartupStrategy;

/// The durable facts the startup-strategy decision branches on, gathered by
/// the IO layer in `startup.rs`.
pub(super) struct SessionStartupFacts {
    /// The session has an inbound `Fork` link (it is a fork child).
    pub is_fork_child: bool,
    /// The session's own native session id, if one was ever recorded.
    pub native_session_id: Option<String>,
    /// Fork-parent lookup result: `None` when no parent link row was found
    /// (or the lookup was not needed), `Some(parent.native_session_id)` when
    /// the parent row exists.
    pub fork_parent_native_session_id: Option<Option<String>>,
    pub agent_kind: String,
    pub has_last_prompt_at: bool,
    pub has_turn_started_event: bool,
    /// The recorded fork operation's provider anchor, when this session is a
    /// fork child and the operation persisted one. `None` for a tip fork or
    /// when no fork operation row was found.
    pub fork_provider_anchor: Option<ProviderForkAnchor>,
    /// Whether the fork operation that created this child targeted a specific
    /// boundary (vs a tip fork). Gathered from `anchor_turn_id.is_some()` on
    /// the child's fork operation row.
    pub fork_target_was_targeted: bool,
}

/// Pure startup-strategy matrix: gathered facts in, a `SessionStartupStrategy`
/// out. All fact gathering lives in `startup.rs`; this stays data-in/data-out.
pub(super) fn choose_startup_strategy(
    facts: &SessionStartupFacts,
) -> anyhow::Result<SessionStartupStrategy> {
    if facts.is_fork_child {
        return choose_fork_child_strategy(facts);
    }

    let Some(native_session_id) = facts.native_session_id.clone() else {
        if facts.has_turn_started_event {
            return Ok(SessionStartupStrategy::ResumeSeqFreshNative);
        }
        return Ok(SessionStartupStrategy::Fresh);
    };

    if facts.agent_kind != AgentKind::Claude.as_str() {
        return Ok(SessionStartupStrategy::LoadNative(native_session_id));
    }

    // A durable `turn_started` protects the narrow crash window where the sink
    // has already persisted a real turn but `last_prompt_at` has not been
    // updated yet. Outside that window, `last_prompt_at` is the fast path.
    if facts.has_last_prompt_at || facts.has_turn_started_event {
        return Ok(SessionStartupStrategy::LoadNative(native_session_id));
    }

    Ok(SessionStartupStrategy::ResumeSeqFreshNative)
}

/// Startup strategy for a fork child.
///
/// When a fork child's recorded native id is reloadable depends on the adapter:
///
/// - adapters with durable fork ids (e.g. Codex) get a reloadable native id at
///   fork time, so a recorded id always loads with no fallback.
/// - adapters whose fork ids are process-local until first prompt (Claude — see
///   `specs/systems/sessions/anyharness-sessions.md` fork invariants) cannot safely recover a
///   zero-turn child on a cold process. Re-forking without the R1 replay proof
///   could silently select the wrong parent prefix, while loading the recorded
///   process-local id is known to fail.
///
/// So for a child that has its own native id:
/// - already ran its own turn (`has_last_prompt_at`), or a durable-fork adapter:
///   load it with no fallback (re-forking would lose the child's own turns).
/// - a process-local-fork (Claude) child that has not run yet: fail closed. R1
///   owns exact-prefix recovery and its proof; this slice must not redispatch.
///
/// Residual window: `has_last_prompt_at` flips at turn start
/// (`actor/turn/active.rs::update_last_prompt_at`), slightly before Claude
/// persists the transcript, so a crash during the child's very first turn can
/// leave a recorded `last_prompt_at` with a non-durable native id. There is no
/// lossless local recovery for a child that has started its own turn (re-forking
/// from the parent would drop that turn), so this narrow case is left to the
/// existing error surface (tracked as a follow-up).
///
/// Note the deliberate asymmetry with the non-fork Claude branch above, which
/// keys on `has_turn_started_event`: that signal is unusable here because the
/// fork transcript snapshot copies the parent's `turn_started` events into the
/// child (`store/links.rs::insert_fork_session_with_link_and_event_snapshot`),
/// so it is `true` for every fork child regardless of its own activity. Only
/// `has_last_prompt_at` distinguishes "child has run since the fork." Do not
/// unify the two branches.
fn choose_fork_child_strategy(
    facts: &SessionStartupFacts,
) -> anyhow::Result<SessionStartupStrategy> {
    let fork_id_is_process_local = fork_id_is_process_local(&facts.agent_kind);

    if fork_id_is_process_local && !facts.has_last_prompt_at {
        anyhow::bail!(
            "process-local zero-turn fork recovery requires an exact-prefix recovery proof"
        );
    }

    if let Some(native_session_id) = facts.native_session_id.clone() {
        // Durable-fork adapters, or a child that has already run its own turn:
        // the recorded native id is reloadable.
        if facts.has_last_prompt_at || !fork_id_is_process_local {
            return Ok(SessionStartupStrategy::LoadNativeNoFallback(
                native_session_id,
            ));
        }
        unreachable!("zero-turn process-local forks fail closed above");
    }

    // A persisted child without its own native id cannot be redispatched on a
    // cold actor. Process-local adapters need R1's exact-prefix proof, while a
    // durable adapter reaching this state is incomplete/corrupt. In both
    // cases, a second native fork would violate at-most-once dispatch.
    match facts.fork_parent_native_session_id.as_ref() {
        None => anyhow::bail!("fork child is missing its parent link"),
        Some(None) => anyhow::bail!("fork parent is missing native session id"),
        Some(Some(parent_native_session_id)) if parent_native_session_id.trim().is_empty() => {
            anyhow::bail!("fork parent is missing native session id")
        }
        Some(Some(_)) => {}
    }
    if facts.fork_target_was_targeted {
        anyhow::ensure!(
            facts.fork_provider_anchor.is_some(),
            "targeted fork child is missing its recorded provider anchor"
        );
    }
    anyhow::bail!("fork child is missing a reloadable native session id")
}

/// Whether an adapter's fork ids are process-local until the child's first
/// prompt (vs durable at fork time). Single source for the distinction that
/// also gates `fork.rs::child_actor_forks`; the two must stay in lockstep — a
/// child only reaches the zero-turn "stale native id" state if it was forked on
/// the child actor here. Currently Claude is the only process-local adapter; a
/// typed adapter capability would be the longer-term home (see PR follow-up).
pub(super) fn fork_id_is_process_local(agent_kind: &str) -> bool {
    agent_kind == AgentKind::Claude.as_str()
}

/// Precondition: a closed session row never launches.
pub(super) fn session_is_closed(record: &SessionRecord) -> bool {
    record.closed_at.is_some() || record.dismissed_at.is_some() || record.status == "closed"
}

/// Resolved facts a launch is assembled from. Private to the runtime module:
/// `startup.rs` gathers these via its resolve steps and hands them over.
pub(super) struct SessionLaunchContext {
    pub record: SessionRecord,
    pub agent: ResolvedAgent,
    pub workspace_path: PathBuf,
    pub workspace_env: BTreeMap<String, String>,
    pub session_env: BTreeMap<String, String>,
    /// Rendered agent-auth route layer for this launch (empty for
    /// native/legacy). See `domains::agent_auth::route_auth`.
    pub route_auth: RenderedRouteAuth,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub startup: SessionStartupStrategy,
    pub every_prompt_append: Option<String>,
    pub first_prompt_append: Option<String>,
}

/// Pure assembly of the launch bundle from already-resolved facts.
pub(super) fn assemble_session_launch(ctx: SessionLaunchContext) -> SessionLaunch {
    SessionLaunch {
        session: ctx.record,
        agent: ctx.agent,
        workspace_path: ctx.workspace_path,
        // The seat this rendered route serves on (rotation's pick), carried to
        // the actor so a successful spawn can confirm it served.
        serving_seat_id: ctx.route_auth.serving_seat_id.clone(),
        env: LaunchEnv {
            workspace: ctx.workspace_env,
            session: ctx.session_env,
            route_auth: ctx.route_auth.set,
            route_auth_remove: ctx.route_auth.remove,
            // Catalog-authored launch settings were an executable authority.
            // Product-owned route/auth and exact target-observed controls are
            // now the only agent-specific launch inputs.
            settings_extra_args: Vec::new(),
        },
        mcp_servers: ctx.mcp_servers,
        startup: ctx.startup,
        prompts: SystemPromptAppends {
            every_prompt: ctx.every_prompt_append,
            first_prompt: ctx.first_prompt_append,
        },
        // Overwritten by the manager under the start/inject critical section.
        last_seq: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> SessionStartupFacts {
        SessionStartupFacts {
            is_fork_child: false,
            native_session_id: None,
            fork_parent_native_session_id: None,
            agent_kind: "claude".to_string(),
            has_last_prompt_at: false,
            has_turn_started_event: false,
            fork_provider_anchor: None,
            fork_target_was_targeted: false,
        }
    }

    #[test]
    fn fresh_when_no_native_session_and_no_history() {
        let strategy = choose_startup_strategy(&facts()).expect("strategy");
        assert_eq!(strategy, SessionStartupStrategy::Fresh);
    }

    #[test]
    fn resume_seq_fresh_native_when_history_exists_without_native_session() {
        let mut facts = facts();
        facts.agent_kind = "codex".to_string();
        facts.has_turn_started_event = true;

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(strategy, SessionStartupStrategy::ResumeSeqFreshNative);
    }

    #[test]
    fn resume_seq_fresh_native_for_zero_turn_claude_sessions() {
        let mut facts = facts();
        facts.native_session_id = Some("native-1".to_string());

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(strategy, SessionStartupStrategy::ResumeSeqFreshNative);
    }

    #[test]
    fn loads_claude_when_last_prompt_was_recorded() {
        let mut facts = facts();
        facts.native_session_id = Some("native-1".to_string());
        facts.has_last_prompt_at = true;

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNative("native-1".to_string())
        );
    }

    #[test]
    fn loads_claude_when_turn_history_exists_without_last_prompt_at() {
        let mut facts = facts();
        facts.native_session_id = Some("native-1".to_string());
        facts.has_turn_started_event = true;

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNative("native-1".to_string())
        );
    }

    #[test]
    fn keeps_non_claude_agents_on_native_load_path() {
        let mut facts = facts();
        facts.agent_kind = "codex".to_string();
        facts.native_session_id = Some("native-1".to_string());

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNative("native-1".to_string())
        );
    }

    #[test]
    fn loads_started_fork_children_without_fresh_fallback() {
        // A fork child that has run its own turn has a durable native
        // transcript; load it with no fallback (re-forking would lose the
        // child's own turns).
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.native_session_id = Some("fork-native".to_string());
        facts.has_last_prompt_at = true;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNativeNoFallback("fork-native".to_string())
        );
    }

    #[test]
    fn refuses_zero_turn_process_local_fork_child_with_native_id() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.native_session_id = Some("stale-fork-native".to_string());
        facts.has_last_prompt_at = false;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));

        let error = choose_startup_strategy(&facts).expect_err("cold recovery must refuse");
        assert_eq!(
            error.to_string(),
            "process-local zero-turn fork recovery requires an exact-prefix recovery proof"
        );
    }

    #[test]
    fn zero_turn_process_local_fork_refuses_even_when_parent_is_unresolvable() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.native_session_id = Some("fork-native".to_string());
        facts.has_last_prompt_at = false;
        facts.fork_parent_native_session_id = Some(None);

        let error = choose_startup_strategy(&facts).expect_err("cold recovery must refuse");
        assert_eq!(
            error.to_string(),
            "process-local zero-turn fork recovery requires an exact-prefix recovery proof"
        );
    }

    #[test]
    fn targeted_process_local_fork_child_with_anchor_still_refuses_cold_recovery() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));
        facts.fork_target_was_targeted = true;
        facts.fork_provider_anchor = Some(ProviderForkAnchor::UpToMessageId("msg-1".to_string()));

        let error = choose_startup_strategy(&facts).expect_err("cold recovery must refuse");
        assert_eq!(
            error.to_string(),
            "process-local zero-turn fork recovery requires an exact-prefix recovery proof"
        );
    }

    #[test]
    fn targeted_fork_child_without_a_recorded_anchor_errors_instead_of_silently_tip_forking() {
        // Negative control: same facts as the previous test, but with the
        // anchor missing — a targeted child must never silently re-fork at
        // the parent tip (frozen ADR 5).
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));
        facts.fork_target_was_targeted = true;
        facts.fork_provider_anchor = None;

        let error = choose_startup_strategy(&facts).expect_err("missing recorded anchor");
        assert_eq!(
            error.to_string(),
            "process-local zero-turn fork recovery requires an exact-prefix recovery proof"
        );
    }

    #[test]
    fn loads_non_claude_zero_turn_fork_child_without_refork() {
        // Durable-fork adapters keep their recorded native id even with no first
        // prompt; process-local (Claude) zero-turn children fail closed instead.
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.agent_kind = "codex".to_string();
        facts.native_session_id = Some("fork-native".to_string());
        facts.has_last_prompt_at = false;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNativeNoFallback("fork-native".to_string())
        );
    }

    #[test]
    fn refuses_unstarted_process_local_fork_children_on_cold_start() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));

        let error = choose_startup_strategy(&facts).expect_err("cold recovery must refuse");
        assert_eq!(
            error.to_string(),
            "process-local zero-turn fork recovery requires an exact-prefix recovery proof"
        );
    }

    #[test]
    fn errors_when_fork_child_is_missing_its_parent_link() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.agent_kind = "codex".to_string();

        let error = choose_startup_strategy(&facts).expect_err("missing parent link");
        assert_eq!(error.to_string(), "fork child is missing its parent link");
    }

    #[test]
    fn errors_when_fork_parent_is_missing_native_session_id() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.agent_kind = "codex".to_string();
        facts.fork_parent_native_session_id = Some(Some("   ".to_string()));

        let error = choose_startup_strategy(&facts).expect_err("blank parent native id");
        assert_eq!(
            error.to_string(),
            "fork parent is missing native session id"
        );

        facts.fork_parent_native_session_id = Some(None);
        let error = choose_startup_strategy(&facts).expect_err("absent parent native id");
        assert_eq!(
            error.to_string(),
            "fork parent is missing native session id"
        );
    }

    #[test]
    fn session_is_closed_checks_closed_at_and_status() {
        let mut record = crate::domains::sessions::runtime::tests::session_record("claude");
        assert!(!session_is_closed(&record));

        record.status = "closed".to_string();
        assert!(session_is_closed(&record));

        record.status = "idle".to_string();
        record.closed_at = Some("2026-03-25T00:00:00Z".to_string());
        assert!(session_is_closed(&record));

        record.closed_at = None;
        record.dismissed_at = Some("2026-03-25T00:01:00Z".to_string());
        assert!(session_is_closed(&record));
    }
}
