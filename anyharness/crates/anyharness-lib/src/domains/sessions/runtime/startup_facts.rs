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
/// policy may need the parent native id to re-fork — either because the child
/// never had a native id, or because its eagerly-recorded one is process-local
/// and may be dead after a cold restart-before-first-prompt. This intentionally
/// over-fetches for durable-fork (non-Claude) zero-turn children, where the
/// policy ignores the parent id; that is a single harmless row read kept here so
/// the resolve gate doesn't have to duplicate the adapter distinction. A fork
/// child that has already run keeps its durable native id and skips the lookup.
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
    // Closure-on-restart (cardinal sin guard): a targeted fork child must
    // never silently re-fork at the parent tip. Only fork children need the
    // fork operation row; a non-fork session has none.
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
