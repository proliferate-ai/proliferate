//! What the live harness statement admits at session start.
//!
//! These are the pure decisions the start path makes BEFORE anything is sent
//! to the agent: whether a requested model id resolves to one the live session
//! offers, and what to do with a requested control the live statement does not
//! offer under the applied model. They are split out of `handle.rs` so the
//! admission rules can be read and unit-tested without the async apply
//! orchestration around them.

use anyharness_contract::v1::{RawSessionConfigOption, SessionConfigOptionType};

use crate::domains::sessions::live_config::controls::option_matches_key;
use crate::domains::sessions::live_config::{NormalizedControlKind, LEGACY_MODE_COMPAT_CONFIG_ID};
use crate::live::sessions::actor::config::confirmation::config_value_matches_current_state;
use crate::live::sessions::actor::config::selection::{
    find_select_option_for_request, into_raw_pending_option, select_option_values,
};
use crate::live::sessions::actor::state::SessionStartupState;

/// How the start path treats one explicit control value against the live
/// statement. Create-time validation runs against the harness-level
/// observation, but some harnesses narrow a QUALITY control's value set per
/// model (codex reasoning_effort). A quality value the live session does not
/// OFFER after the model applied is dropped to the session default rather than
/// failing the whole start. The membership check runs before anything is sent;
/// an OFFERED value whose setter read-back refuses it stays fatal — the same
/// invariant the legacy mode branch keeps.
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
    let offered = find_select_option_for_request(&startup_state.config_options, config_id)
        .is_some_and(|option| {
            select_option_values(option)
                .iter()
                .any(|candidate| candidate == value)
        });
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

/// Whether a control id the live statement never surfaced is a posture control.
///
/// `is_posture_control` classifies a live option, so it cannot answer for an id
/// that is absent: the lookup returns `None` and every absent id would read as
/// non-posture. Classifying the bare id through the same `option_matches_key`
/// vocabulary keeps one definition of posture instead of a second id list that
/// could drift from it.
pub(in crate::live::sessions::actor) fn absent_control_is_posture(config_id: &str) -> bool {
    if config_id == LEGACY_MODE_COMPAT_CONFIG_ID {
        return true;
    }
    let probe = RawSessionConfigOption {
        id: config_id.to_string(),
        name: String::new(),
        description: None,
        category: None,
        option_type: SessionConfigOptionType::Select,
        current_value: String::new(),
        options: Vec::new(),
    };
    option_matches_key(&probe, NormalizedControlKind::Mode)
        || option_matches_key(&probe, NormalizedControlKind::CollaborationMode)
}

/// Resolves the create-time model id against the ids the live session offers.
///
/// Exact membership stays the primary rule. When the exact id is absent, a
/// live id whose bracket-stripped base equals the requested id's base is the
/// same model selection under a rotated context-variant id, and resolution
/// succeeds only when exactly one such live id exists. Everything else stays
/// fail-closed: no base match, or an ambiguous one, refuses the start exactly
/// as before.
pub(in crate::live::sessions::actor) fn resolve_requested_model_id(
    live_ids: &[String],
    requested: &str,
) -> Option<String> {
    if live_ids.iter().any(|value| value == requested) {
        return Some(requested.to_string());
    }
    let requested_base = base_model_id(requested);
    if requested_base.is_empty() {
        return None;
    }
    let mut candidates = live_ids
        .iter()
        .filter(|value| base_model_id(value) == requested_base);
    let first = candidates.next()?;
    if candidates.next().is_some() {
        return None;
    }
    Some(first.clone())
}

/// The id with any trailing bracket variant marker removed:
/// `claude-fable-5[1m]` -> `claude-fable-5`.
fn base_model_id(id: &str) -> &str {
    match id.find('[') {
        Some(index) => &id[..index],
        None => id,
    }
}

#[cfg(test)]
mod tests {
    use super::{absent_control_is_posture, resolve_requested_model_id};

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
    fn rotated_variant_resolves_from_base_request() {
        let ids = live(&[
            "default",
            "opus[1m]",
            "claude-fable-5[1m]",
            "sonnet",
            "haiku",
        ]);
        assert_eq!(
            resolve_requested_model_id(&ids, "claude-fable-5").as_deref(),
            Some("claude-fable-5[1m]")
        );
    }

    #[test]
    fn variant_request_resolves_to_plain_base() {
        let ids = live(&["default", "claude-fable-5", "sonnet"]);
        assert_eq!(
            resolve_requested_model_id(&ids, "claude-fable-5[1m]").as_deref(),
            Some("claude-fable-5")
        );
    }

    #[test]
    fn exact_match_preferred_over_base_candidates() {
        let ids = live(&["claude-fable-5", "claude-fable-5[1m]"]);
        assert_eq!(
            resolve_requested_model_id(&ids, "claude-fable-5[1m]").as_deref(),
            Some("claude-fable-5[1m]")
        );
    }

    #[test]
    fn ambiguous_base_match_fails_closed() {
        let ids = live(&["claude-fable-5[1m]", "claude-fable-5[200k]"]);
        assert_eq!(resolve_requested_model_id(&ids, "claude-fable-5"), None);
    }

    #[test]
    fn unknown_model_fails_closed() {
        let ids = live(&["default", "sonnet", "haiku"]);
        assert_eq!(resolve_requested_model_id(&ids, "claude-fable-5"), None);
    }

    #[test]
    fn bracket_only_request_fails_closed() {
        let ids = live(&["default", "sonnet"]);
        assert_eq!(resolve_requested_model_id(&ids, "[1m]"), None);
    }

    // Absent-control disposition. claude narrows the control SET per model:
    // `fast` exists only under opus, and haiku drops `effort` too. A quality
    // control the applied model does not surface must launch without it
    // instead of failing the start; a posture control must still refuse.

    #[test]
    fn absent_fast_control_is_not_posture() {
        assert!(!absent_control_is_posture("fast"));
        assert!(!absent_control_is_posture("fast_mode"));
    }

    #[test]
    fn absent_quality_controls_are_not_posture() {
        assert!(!absent_control_is_posture("effort"));
        assert!(!absent_control_is_posture("reasoning_effort"));
        assert!(!absent_control_is_posture("verbosity"));
    }

    #[test]
    fn absent_mode_family_stays_posture() {
        assert!(absent_control_is_posture("mode"));
        assert!(absent_control_is_posture("collaboration_mode"));
        assert!(absent_control_is_posture("sandbox_mode"));
        assert!(absent_control_is_posture("approval_policy"));
    }

    #[test]
    fn absent_model_control_never_reads_as_posture_mode() {
        // "model" contains "mode": the model row must not be judged against
        // the posture vocabulary.
        assert!(!absent_control_is_posture("model"));
    }
}
