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
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::model::SessionRecord;
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
}

/// Pure startup-strategy matrix. Behavior-equivalent to the pre-split
/// store-coupled decision; only the fact gathering moved out.
pub(super) fn choose_startup_strategy(
    facts: &SessionStartupFacts,
) -> anyhow::Result<SessionStartupStrategy> {
    if facts.is_fork_child {
        if let Some(native_session_id) = facts.native_session_id.clone() {
            return Ok(SessionStartupStrategy::LoadNativeNoFallback(
                native_session_id,
            ));
        }
        let parent_native_session_id = facts
            .fork_parent_native_session_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("fork child is missing its parent link"))?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("fork parent is missing native session id"))?;
        return Ok(SessionStartupStrategy::ForkFromNative {
            parent_native_session_id,
        });
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

/// Precondition: a closed session row never launches.
pub(super) fn session_is_closed(record: &SessionRecord) -> bool {
    record.closed_at.is_some() || record.status == "closed"
}

/// Resolved facts a launch is assembled from. Private to the runtime module:
/// `startup.rs` gathers these via its resolve steps and hands them over.
pub(super) struct SessionLaunchContext {
    pub record: SessionRecord,
    pub agent: ResolvedAgent,
    pub workspace_path: PathBuf,
    pub workspace_env: BTreeMap<String, String>,
    pub session_env: BTreeMap<String, String>,
    pub auth_support_env: BTreeMap<String, String>,
    /// Secrets — never logged.
    pub auth_protected_env: BTreeMap<String, String>,
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
        env: LaunchEnv {
            workspace: ctx.workspace_env,
            session: ctx.session_env,
            auth_support: ctx.auth_support_env,
            auth_protected: ctx.auth_protected_env,
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
    fn loads_fork_children_without_fresh_fallback() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.native_session_id = Some("fork-native".to_string());

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::LoadNativeNoFallback("fork-native".to_string())
        );
    }

    #[test]
    fn forks_unstarted_fork_children_from_parent_native_id() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.fork_parent_native_session_id = Some(Some("parent-native".to_string()));

        let strategy = choose_startup_strategy(&facts).expect("strategy");
        assert_eq!(
            strategy,
            SessionStartupStrategy::ForkFromNative {
                parent_native_session_id: "parent-native".to_string()
            }
        );
    }

    #[test]
    fn errors_when_fork_child_is_missing_its_parent_link() {
        let mut facts = facts();
        facts.is_fork_child = true;

        let error = choose_startup_strategy(&facts).expect_err("missing parent link");
        assert_eq!(error.to_string(), "fork child is missing its parent link");
    }

    #[test]
    fn errors_when_fork_parent_is_missing_native_session_id() {
        let mut facts = facts();
        facts.is_fork_child = true;
        facts.fork_parent_native_session_id = Some(Some("   ".to_string()));

        let error = choose_startup_strategy(&facts).expect_err("blank parent native id");
        assert_eq!(error.to_string(), "fork parent is missing native session id");

        facts.fork_parent_native_session_id = Some(None);
        let error = choose_startup_strategy(&facts).expect_err("absent parent native id");
        assert_eq!(error.to_string(), "fork parent is missing native session id");
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
    }
}
