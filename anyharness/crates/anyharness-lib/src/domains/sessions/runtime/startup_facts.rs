//! The resolve step of session startup: gather the durable facts, then let
//! the pure policy in `launch_policy` pick the strategy. Split out of
//! `startup.rs` (PROD-SIZE-1) along the seam its own contract names — this
//! module reads stores, `launch_policy` decides.

use crate::domains::sessions::links::model::SessionLinkRelation;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::SessionStartupStrategy;

use super::launch_policy::{choose_startup_strategy, SessionStartupFacts};

/// Resolve steps only — gather the durable facts, then let the pure policy in
/// `launch_policy` pick the strategy. The parent lookup is gated to fork
/// children that have not yet run their own turn (`last_prompt_at` unset): the
/// policy uses the parent/link facts only to classify incomplete durable state;
/// they never authorize a second native fork. Process-local zero-turn children
/// fail closed until the exact-prefix recovery owner lands. A fork child that
/// has already run keeps its durable native id and skips the lookup.
pub(super) fn choose_session_startup_strategy(
    record: &SessionRecord,
    session_store: &SessionStore,
) -> anyhow::Result<SessionStartupStrategy> {
    let is_fork_child =
        session_store.has_inbound_link_relation(&record.id, SessionLinkRelation::Fork)?;
    let fork_parent_native_session_id = if is_fork_child && record.last_prompt_at.is_none() {
        session_store
            .find_parent_by_inbound_link_relation(&record.id, SessionLinkRelation::Fork)?
            .map(|parent| parent.native_session_id)
    } else {
        None
    };
    // Recovery provenance remains useful for corruption diagnostics, but no
    // cold-start branch may silently re-fork at the parent tip.
    let (fork_provider_anchor, fork_target_was_targeted) = if is_fork_child {
        match session_store.find_fork_operation_by_child(&record.id)? {
            Some(operation) => {
                let anchor = match (
                    operation.provider_anchor_kind.as_deref(),
                    operation.provider_anchor_value,
                ) {
                    (Some("message_id"), Some(value)) => {
                        Some(ProviderForkAnchor::UpToMessageId(value))
                    }
                    (Some("turn_id"), Some(value)) => Some(ProviderForkAnchor::LastTurnId(value)),
                    _ => None,
                };
                (anchor, operation.anchor_turn_id.is_some())
            }
            None => (None, false),
        }
    } else {
        (None, false)
    };
    choose_startup_strategy(&SessionStartupFacts {
        is_fork_child,
        native_session_id: record.native_session_id.clone(),
        fork_parent_native_session_id,
        agent_kind: record.agent_kind.clone(),
        has_last_prompt_at: record.last_prompt_at.is_some(),
        has_turn_started_event: session_store.has_turn_started_event(&record.id)?,
        fork_provider_anchor,
        fork_target_was_targeted,
    })
}

/// Would a cold start of this session resolve to a launch strategy right now?
///
/// The idle reaper asks this before retiring an actor: retirement is only
/// non-terminal if the session can actually be started again, and the startup
/// matrix refuses some durable shapes outright. The load-bearing one is a
/// process-local (Claude) zero-turn fork child, which is inserted with
/// `last_prompt_at: None` and finalizes to `Idle`, so it is fully quiescent
/// and would otherwise be reaped into a state no prompt can leave
/// (`choose_fork_child_strategy` bails with "process-local zero-turn fork
/// recovery requires an exact-prefix recovery proof").
///
/// This is the same decision the next prompt will make, evaluated against the
/// same durable rows, so it cannot drift from the launch policy. A missing
/// session row answers `false`: no strategy exists for a row that is not
/// there, and holding an unrecognised actor costs memory while retiring it
/// could cost the session.
pub(crate) fn session_can_relaunch_from_cold(
    session_store: &SessionStore,
    session_id: &str,
) -> anyhow::Result<bool> {
    let Some(record) = session_store.find_by_id(session_id)? else {
        return Ok(false);
    };
    Ok(choose_session_startup_strategy(&record, session_store).is_ok())
}
