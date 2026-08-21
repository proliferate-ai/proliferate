//! What the live harness statement admits at session start.
//!
//! These are the pure decisions the start path makes BEFORE anything is sent
//! to the agent: whether a requested model id resolves to one the live session
//! offers, and what to do with a requested control the live statement does not
//! offer under the applied model. They are split out of `handle.rs` so the
//! admission rules can be read and unit-tested without the async apply
//! orchestration around them.

use crate::domains::sessions::live_config::controls::option_matches_key;
use crate::domains::sessions::live_config::{NormalizedControlKind, LEGACY_MODE_COMPAT_CONFIG_ID};
use crate::live::sessions::actor::config::confirmation::config_value_matches_current_state;
use crate::live::sessions::actor::config::selection::{
    find_select_option_for_request, into_raw_pending_option, select_option_values,
};
use crate::live::sessions::actor::state::SessionStartupState;

/// How the start path treats one explicit control value against the live
/// statement. Create-time validation runs against the selected model's
/// observation when available, but some harnesses narrow a QUALITY control's
/// value set further at live-session time (codex reasoning_effort). A quality
/// value the live session does not OFFER after the model applied is dropped to
/// the session default rather than failing the whole start. The membership
/// check runs before anything is sent; an OFFERED value whose setter read-back
/// refuses it stays fatal — the same invariant the legacy mode branch keeps.
///
/// Posture controls are never dropped: launching a collaboration mode, mode /
/// approval policy or sandbox mode at the harness default after the user
/// explicitly selected against it is a silent behavior change, which is
/// strictly worse than refusing the start.
#[derive(Debug, PartialEq, Eq)]
pub(in crate::live::sessions::actor) enum InitialControlDisposition {
    AlreadyLive,
    Apply,
    Drop,
    Refuse,
}

pub(in crate::live::sessions::actor) fn initial_control_disposition(
    startup_state: &SessionStartupState,
    config_id: &str,
    value: &str,
) -> InitialControlDisposition {
    if config_value_matches_current_state(startup_state, config_id, value) {
        return InitialControlDisposition::AlreadyLive;
    }
    let Some(option) = find_select_option_for_request(&startup_state.config_options, config_id)
    else {
        return InitialControlDisposition::Refuse;
    };
    let offered = select_option_values(option)
        .iter()
        .any(|candidate| candidate == value);
    if offered {
        InitialControlDisposition::Apply
    } else if is_posture_control(startup_state, config_id) {
        InitialControlDisposition::Refuse
    } else {
        InitialControlDisposition::Drop
    }
}

/// A posture control decides what the agent is allowed to DO — collaboration
/// mode, the mode / approval-policy family, sandbox mode. Only quality and
/// model-narrowing controls are eligible for the soft drop.
fn is_posture_control(startup_state: &SessionStartupState, config_id: &str) -> bool {
    if config_id == LEGACY_MODE_COMPAT_CONFIG_ID {
        return true;
    }
    find_select_option_for_request(&startup_state.config_options, config_id).is_some_and(|option| {
        let raw = into_raw_pending_option(option);
        option_matches_key(&raw, NormalizedControlKind::Mode)
            || option_matches_key(&raw, NormalizedControlKind::CollaborationMode)
    })
}

/// Resolves the create-time model id against the ids the live session offers.
///
/// Model identifiers are executable identity, including context-variant
/// suffixes. Only exact membership resolves; an absent id stays fail-closed.
pub(in crate::live::sessions::actor) fn resolve_requested_model_id(
    live_ids: &[String],
    requested: &str,
) -> Option<String> {
    live_ids
        .iter()
        .any(|value| value == requested)
        .then(|| requested.to_string())
}

#[cfg(test)]
mod tests {
    use super::resolve_requested_model_id;

    fn live(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn exact_match_wins() {
        let ids = live(&["default", "claude-fable-5", "sonnet"]);
        assert_eq!(
            resolve_requested_model_id(&ids, "claude-fable-5").as_deref(),
            Some("claude-fable-5")
        );
    }

    #[test]
    fn context_variant_is_not_substituted() {
        let ids = live(&["default", "claude-fable-5", "sonnet"]);
        assert_eq!(resolve_requested_model_id(&ids, "claude-fable-5[1m]"), None);
    }

    #[test]
    fn unknown_model_fails_closed() {
        let ids = live(&["default", "sonnet", "haiku"]);
        assert_eq!(resolve_requested_model_id(&ids, "claude-fable-5"), None);
    }
}
