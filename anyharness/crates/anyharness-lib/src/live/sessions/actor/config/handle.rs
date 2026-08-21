use agent_client_protocol as acp;
use anyharness_contract::v1::{
    ConfigApplyState, RawSessionConfigOption, SessionConfigOptionType,
};

use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::live_config::controls::option_matches_key;
use crate::domains::sessions::live_config::{NormalizedControlKind, LEGACY_MODE_COMPAT_CONFIG_ID};
use crate::live::sessions::actor::config::apply::{
    apply_mode_via_direct_setter_legacy, apply_specific_config_option, try_apply_model_preference,
};
use crate::live::sessions::actor::config::confirmation::config_value_matches_current_state;
use crate::live::sessions::actor::config::persist::persist_requested_config_value_if_changed;
use crate::live::sessions::actor::config::queue::queue_pending_config_change;
use crate::live::sessions::actor::config::selection::{
    find_select_option_by_purpose, find_select_option_for_request, into_raw_pending_option,
    select_option_values,
};
use crate::live::sessions::actor::config::types::{
    tracked_config_purpose, ConfigApplyOutcome, ConfigPurpose,
};
use crate::live::sessions::actor::state::{SessionActor, SessionStartupState};

/// Applies the immutable create-time intent and accepts only a value that the
/// live harness statement both advertises and positively confirms. Model is
/// first; controls follow the harness-advertised order.
///
/// The one carve-out is per-model narrowing on a NON-posture control. A
/// harness narrows both a control's VALUE set and the control SET itself per
/// model: codex drops `max` from reasoning_effort under some models, and
/// claude surfaces `fast` only under opus while haiku loses `effort` as well.
/// The create-time observation is harness-level, so it carries the union. A
/// quality knob whose requested value — or whose whole row — the applied model
/// does not offer therefore launches without it instead of failing the start.
///
/// Posture controls stay fail-closed in both cases: launching a collaboration
/// mode, mode / approval policy or sandbox mode at the harness default after
/// the user explicitly selected against it is a silent behavior change, which
/// is strictly worse than refusing the start.
pub(in crate::live::sessions::actor) async fn apply_resolved_launch_intent(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    session_id: &str,
    agent_kind: &str,
    intent: &ResolvedLaunchIntent,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<()> {
    let resolved_model_id = match intent.model_id.as_deref() {
        Some(model_id) => {
            match resolve_requested_model_id(&live_model_ids(startup_state), model_id) {
                Some(resolved) => {
                    if resolved != model_id {
                        // The live statement renamed the id between the create-time
                        // observation and this session (a context-variant rotation such
                        // as `claude-fable-5` -> `claude-fable-5[1m]`). The base id is
                        // the same model selection, so launch with the id the live
                        // session actually offers instead of failing the start.
                        tracing::warn!(
                            session_id,
                            harness_kind = agent_kind,
                            requested_model_id = %model_id,
                            resolved_model_id = %resolved,
                            event = "session.initial_config.model_id_rotated",
                            "requested model id resolved to its live variant"
                        );
                    }
                    Some(resolved)
                }
                None => {
                    log_initial_config_apply(session_id, agent_kind, "model", "membership_rejected");
                    anyhow::bail!(
                        "requested model '{model_id}' is absent from the live {agent_kind} session"
                    );
                }
            }
        }
        None => None,
    };
    if let Some(model_id) = resolved_model_id.as_deref() {
        let outcome = match try_apply_model_preference(
            conn,
            native_session_id,
            model_id,
            startup_state,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                log_initial_config_apply(session_id, agent_kind, "model", "apply_failed");
                return Err(error);
            }
        };
        log_initial_config_apply(
            session_id,
            agent_kind,
            "model",
            confirmed_result_code(outcome),
        );
        anyhow::ensure!(
            matches!(outcome, ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative),
            "requested model '{model_id}' was not confirmed by the live {agent_kind} session"
        );
    }

    let mut pending = intent.control_values.clone();
    let mut dropped_control_ids: Vec<String> = Vec::new();
    let ordered_ids = startup_state
        .config_options
        .iter()
        .map(|option| option.id.to_string())
        .collect::<Vec<_>>();
    for config_id in ordered_ids {
        let Some(value) = pending.remove(&config_id) else {
            continue;
        };
        match initial_control_disposition(startup_state, &config_id, &value) {
            InitialControlDisposition::AlreadyLive => {
                log_initial_config_apply(session_id, agent_kind, &config_id, "confirmed");
                continue;
            }
            InitialControlDisposition::Drop => {
                log_initial_config_apply(session_id, agent_kind, &config_id, "membership_dropped");
                tracing::warn!(
                    session_id,
                    harness_kind = agent_kind,
                    control_id = %config_id,
                    event = "session.initial_config.dropped",
                    "requested control value is absent from the live session; launching with its default"
                );
                dropped_control_ids.push(config_id);
                continue;
            }
            InitialControlDisposition::Refuse => {
                log_initial_config_apply(session_id, agent_kind, &config_id, "membership_rejected");
                anyhow::bail!("requested control '{config_id}' value '{value}' is absent from the live {agent_kind} session");
            }
            InitialControlDisposition::Apply => {}
        }
        let outcome = match try_apply_config_option_by_id(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            &value,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                log_initial_config_apply(session_id, agent_kind, &config_id, "apply_failed");
                return Err(error);
            }
        };
        log_initial_config_apply(
            session_id,
            agent_kind,
            &config_id,
            confirmed_result_code(outcome),
        );
        anyhow::ensure!(
            matches!(outcome, ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative),
            "requested control '{config_id}' value '{value}' was not confirmed by the live {agent_kind} session"
        );
    }

    // ACP's legacy mode surface has no config-option row but is still an exact
    // live statement and can positively confirm through set_mode/read-back.
    // The legacy mode surface is a posture control: it decides what the agent
    // is allowed to do, so an absent value stays fatal rather than silently
    // launching at the harness default.
    if let Some(value) = pending.remove(LEGACY_MODE_COMPAT_CONFIG_ID) {
        if !startup_state.legacy_mode_contains_value(&value) {
            log_initial_config_apply(session_id, agent_kind, "mode", "membership_rejected");
            anyhow::bail!("requested control 'mode' value '{value}' is absent from the live {agent_kind} session");
        }
        let outcome = match apply_mode_via_direct_setter_legacy(
            conn,
            native_session_id,
            startup_state,
            &value,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                log_initial_config_apply(session_id, agent_kind, "mode", "apply_failed");
                return Err(error);
            }
        };
        log_initial_config_apply(
            session_id,
            agent_kind,
            "mode",
            confirmed_result_code(outcome),
        );
        anyhow::ensure!(
            matches!(outcome, ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative),
            "requested control 'mode' value '{value}' was not confirmed by the live {agent_kind} session"
        );
    }
    // Harnesses narrow the control SET per model, not just a control's value
    // set: claude surfaces `fast` only under opus, and drops `effort` as well
    // under haiku. The create-time observation is harness-level, so it carries
    // the union — including the harness default `fast: off` that a user who
    // never touched the control still launches with. Refusing every id the
    // applied model does not surface therefore failed the start of every
    // non-opus claude session.
    //
    // An absent QUALITY control is the same per-model narrowing the offered-
    // but-unavailable value branch already drops to the session default. An
    // absent POSTURE control stays fatal: launching at the harness default
    // after the user explicitly selected a mode or collaboration mode is a
    // silent behavior change, which is worse than refusing the start.
    let absent_posture_ids = pending
        .keys()
        .filter(|config_id| absent_control_is_posture(config_id))
        .cloned()
        .collect::<Vec<_>>();
    anyhow::ensure!(
        absent_posture_ids.is_empty(),
        "requested controls are absent from the live {agent_kind} session: {absent_posture_ids:?}"
    );
    for (config_id, _) in std::mem::take(&mut pending) {
        log_initial_config_apply(session_id, agent_kind, &config_id, "membership_dropped");
        tracing::warn!(
            session_id,
            harness_kind = agent_kind,
            control_id = %config_id,
            event = "session.initial_config.dropped",
            "requested control is absent from the live session under the applied model; launching without it"
        );
        dropped_control_ids.push(config_id);
    }
    let mut confirmed_intent = intent_without_dropped_controls(intent, &dropped_control_ids);
    confirmed_intent.model_id = resolved_model_id;
    if let Err(error) = ensure_resolved_launch_intent_confirmed(startup_state, &confirmed_intent) {
        log_initial_config_apply(session_id, agent_kind, "complete_intent", "final_mismatch");
        return Err(error);
    }
    tracing::info!(
        harness = agent_kind,
        selected_model = intent.model_id.is_some(),
        selected_control_count = confirmed_intent.control_values.len(),
        dropped_control_count = dropped_control_ids.len(),
        event = "session.launch_intent.confirmed",
        "confirmed every applicable explicit launch intent value"
    );
    Ok(())
}

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
            select_option_values(option).iter().any(|candidate| candidate == value)
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
fn absent_control_is_posture(config_id: &str) -> bool {
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

pub(in crate::live::sessions::actor) fn intent_without_dropped_controls(
    intent: &ResolvedLaunchIntent,
    dropped_control_ids: &[String],
) -> ResolvedLaunchIntent {
    if dropped_control_ids.is_empty() {
        return intent.clone();
    }
    let mut confirmed = intent.clone();
    confirmed
        .control_values
        .retain(|config_id, _| !dropped_control_ids.contains(config_id));
    confirmed
}

pub(in crate::live::sessions::actor) fn ensure_resolved_launch_intent_confirmed(
    startup_state: &SessionStartupState,
    intent: &ResolvedLaunchIntent,
) -> anyhow::Result<()> {
    if let Some(model_id) = intent.model_id.as_deref() {
        anyhow::ensure!(
            config_value_matches_current_state(startup_state, "model", model_id),
            "final live model does not equal requested model '{model_id}'"
        );
    }
    for (config_id, value) in &intent.control_values {
        anyhow::ensure!(
            config_value_matches_current_state(startup_state, config_id, value),
            "final live control '{config_id}' does not equal requested value '{value}'"
        );
    }
    Ok(())
}

fn confirmed_result_code(outcome: ConfigApplyOutcome) -> &'static str {
    match outcome {
        ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative => "confirmed",
        ConfigApplyOutcome::AppliedRequested => "unconfirmed",
        ConfigApplyOutcome::NotApplied => "membership_rejected",
    }
}

fn log_initial_config_apply(
    session_id: &str,
    agent_kind: &str,
    requested_key: &str,
    result_code: &str,
) {
    tracing::info!(
        session_id,
        harness_kind = agent_kind,
        requested_key,
        result_code,
        event = "session.initial_config.apply",
        "initial session configuration apply result"
    );
}

async fn try_apply_config_option_by_id(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    let Some(option) = find_select_option_for_request(&startup_state.config_options, config_id)
    else {
        return Ok(ConfigApplyOutcome::NotApplied);
    };
    if !select_option_values(option).iter().any(|candidate| candidate == value) {
        return Ok(ConfigApplyOutcome::NotApplied);
    }
    crate::live::sessions::actor::config::apply::apply_select_config_option(
        conn,
        native_session_id,
        startup_state,
        config_id,
        value,
    )
    .await
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

fn live_model_ids(startup_state: &SessionStartupState) -> Vec<String> {
    if let Some(option) =
        find_select_option_by_purpose(&startup_state.config_options, ConfigPurpose::Model)
    {
        let values = select_option_values(option);
        if !values.is_empty() {
            return values;
        }
    }

    startup_state
        .available_models
        .iter()
        .map(|model| model.id.clone())
        .collect()
}

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_idle_config_command(
        &mut self,
        config_id: &str,
        value: &str,
        live_snapshot_authorized_model: bool,
    ) -> Result<ConfigApplyState, crate::live::sessions::actor::command::SetConfigOptionCommandError>
    {
        if !self.event_mutations_admitted().await {
            return Err(
                crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(
                    "terminal transaction unresolved".to_string(),
                ),
            );
        }
        apply_specific_config_option(
            &self.conn,
            &self.native_session_id,
            &self.agent_kind,
            &self.session_id,
            self.caps.state.as_ref(),
            &self.event_sink,
            &mut self.persisted_config_state,
            &mut self.startup_state,
            config_id,
            value,
            live_snapshot_authorized_model,
        )
        .await
    }

    pub(in crate::live::sessions::actor) async fn handle_busy_config_command(
        &mut self,
        config_id: &str,
        value: &str,
        live_snapshot_authorized_model: bool,
    ) -> Result<ConfigApplyState, crate::live::sessions::actor::command::SetConfigOptionCommandError>
    {
        if !self.event_mutations_admitted().await {
            return Err(
                crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(
                    "terminal transaction unresolved".to_string(),
                ),
            );
        }
        let resolved_value = queue_pending_config_change(
            self.caps.state.as_ref(),
            &self.session_id,
            &self.startup_state,
            config_id,
            value,
            live_snapshot_authorized_model,
        )?;
        let option = find_select_option_for_request(&self.startup_state.config_options, config_id);

        if let Err(error) = persist_requested_config_value_if_changed(
            self.caps.state.as_ref(),
            &self.event_sink,
            &self.session_id,
            &mut self.persisted_config_state,
            tracked_config_purpose(config_id, option),
            &resolved_value,
            chrono::Utc::now().to_rfc3339(),
        )
        .await
        {
            let _ = self
                .caps
                .state
                .delete_pending_config_change(&self.session_id, config_id);
            return Err(
                crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(
                    error.to_string(),
                ),
            );
        }

        Ok(ConfigApplyState::Queued)
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
        let ids = live(&["default", "opus[1m]", "claude-fable-5[1m]", "sonnet", "haiku"]);
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
