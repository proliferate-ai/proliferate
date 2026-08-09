//! What the configure tools decide before the runtime applies anything.
//!
//! Two questions, one answer: which knobs does the TARGET have right now, and
//! is the value the caller named one of them? Both are answered by composing
//! the target's live snapshot (what its harness advertises) with the launch
//! options resolved for the TARGET's workspace (what that machine may launch
//! there) — never the caller's workspace. A cross-workspace target is the
//! normal case for a peer tool, and the two workspaces can have entirely
//! different catalogs, readiness and auth contexts.
//!
//! The catalog and snapshot arrive as closures rather than a `SessionRuntime`
//! so the composition — including *which workspace id it asks about* — is
//! testable without a runtime.

use anyharness_contract::v1::{NormalizedSessionControl, SessionLiveConfigSnapshot};
use serde_json::{json, Value};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::sessions::authorize::{self, authorize, AgentAccessError, AgentAccessIntent};
use crate::domains::sessions::live_config::ACP_MODEL_COMPAT_CONFIG_ID;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::SessionStore;

/// Where a selectable value came from, so the agent can tell an option its
/// harness is advertising right now from one only the workspace catalog
/// authorizes (which applies through a relaunch).
pub(super) const VALUE_SOURCE_LIVE: &str = "live";
pub(super) const VALUE_SOURCE_WORKSPACE_CATALOG: &str = "workspace_catalog";

#[derive(Debug, thiserror::Error)]
pub(super) enum AgentConfigError {
    #[error(transparent)]
    Access(#[from] AgentAccessError),
    /// Read intent tolerates a closed target because transcripts outlive the
    /// agent. Config options do not: a closed session's actor never starts
    /// again, so its "what can I change now" answer is always "nothing".
    /// Saying so beats handing back an empty menu that reads like a harness
    /// with no controls.
    ///
    /// This is why the READ path refuses the SAME set the change path's `Send`
    /// funnel refuses — closed here, and dismissed just below. Keeping the two
    /// symmetric is the whole point: a read that answered a terminal target
    /// would hand an agent a full menu and then refuse every item on it, which
    /// is strictly worse than one refusal it can act on. Read/write symmetry
    /// here is deliberate, not an accident of where the guard sits.
    ///
    /// Only the READ path raises this. On the change path the `Send` funnel
    /// refuses a closed target first, with its own message — so this one talks
    /// about reading, which is all it ever answers.
    #[error("target session is closed; a closed agent's actor never starts again, so it has no configuration left to read")]
    TargetClosed,
    /// The same refusal, for the same reason, on the other terminal state.
    /// Dismissed is not closed — the row stays open — but `runtime/
    /// launch_policy.rs` refuses to boot it, so its composed menu is a list of
    /// changes that can never be applied. See `target_config_is_unreachable`
    /// for why the read path refuses rather than advertising it.
    #[error("target session was dismissed; a dismissed agent is never launched again, so it has no configuration left to read")]
    TargetDismissed,
    /// An agent reconfiguring itself would route a config command at the very
    /// actor that is blocked inside this tool call, and would queue behind its
    /// own turn. Harness-native controls are the way to change your own model.
    #[error("configure_agent cannot target the calling session; use your harness's own controls to change your configuration")]
    SelfTarget,
    #[error("configId is required")]
    EmptyConfigId,
    #[error("value is required")]
    EmptyValue,
    #[error("unknown configId {config_id:?} for session {session_id}; call get_agent_config_options first. Available: {available}")]
    UnknownConfigId {
        session_id: String,
        config_id: String,
        available: String,
    },
    #[error("value {value:?} is not available for configId {config_id:?} on session {session_id}; available: {available}")]
    ValueNotAvailable {
        session_id: String,
        config_id: String,
        value: String,
        available: String,
    },
    /// The write half of `ComposedControl::settable`. Without it `settable`
    /// would be advisory-for-display only, and a single-value control would
    /// accept its own current value — a "change" that moves nothing while the
    /// read said it could not be changed at all.
    #[error("configId {config_id:?} on session {session_id} is not settable: {value:?} is its only available value and is already current")]
    ControlNotSettable {
        session_id: String,
        config_id: String,
        value: String,
    },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ComposedValue {
    pub value: String,
    pub label: String,
    pub source: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ComposedControl {
    /// The identifier `configure_agent` takes — the same `configId` the human
    /// client posts to `/v1/sessions/{id}/config-options`.
    pub config_id: String,
    /// The normalized product key (`model`, `mode`, `effort`, …) when the
    /// control maps to one.
    pub key: Option<String>,
    pub label: String,
    pub current_value: Option<String>,
    pub values: Vec<ComposedValue>,
}

impl ComposedControl {
    /// Whether asking for a change here can move anything. Two or more values
    /// obviously can. A SINGLE value can too, when it is not the current one —
    /// a harness advertising one option the session has not selected yet is a
    /// real change. What is not settable is the dead end: the only value on
    /// offer is already current, so every request is a no-op.
    ///
    /// `validate_change` ENFORCES this, so the `settable: false` an agent reads
    /// from `get_agent_config_options` is a promise `configure_agent` keeps
    /// rather than advice it is free to ignore.
    fn settable(&self) -> bool {
        match self.values.as_slice() {
            [] => false,
            [only] => self.current_value.as_deref() != Some(only.value.as_str()),
            _ => true,
        }
    }

    fn push_value(&mut self, value: String, label: String, source: &'static str) {
        if self.values.iter().any(|existing| existing.value == value) {
            return;
        }
        self.values.push(ComposedValue {
            value,
            label,
            source,
        });
    }
}

/// The whole answer for one target: who it is, which workspace's catalog was
/// composed in, the union of its knobs, and the raw live snapshot verbatim.
#[derive(Debug, Clone)]
pub(super) struct ComposedAgentConfig {
    pub target: SessionRecord,
    /// The workspace whose launch options were composed. Always the target's.
    pub catalog_workspace_id: String,
    pub controls: Vec<ComposedControl>,
    pub live_config: Option<SessionLiveConfigSnapshot>,
}

impl ComposedAgentConfig {
    fn control(&self, config_id: &str) -> Option<&ComposedControl> {
        self.controls
            .iter()
            .find(|control| control.config_id == config_id)
    }

    fn config_ids(&self) -> String {
        join_quoted(
            self.controls
                .iter()
                .map(|control| control.config_id.as_str()),
        )
    }
}

#[derive(Debug, Clone)]
pub(super) struct PreparedConfigChange {
    pub target: SessionRecord,
    pub config_id: String,
    pub value: String,
}

/// Gate + compose a read. Any authorized caller may look at any LIVE-able
/// session's controls; a closed or dismissed target is refused rather than
/// answered with a menu it can never act on.
///
/// Read and write stay SYMMETRIC on the terminal states on purpose. The change
/// path's `Send` funnel already refuses both, so a read path that answered them
/// would advertise a full menu and then refuse every single item on it — the
/// advertised-then-refused trap, and the worst shape for an agent that has to
/// decide what to do next from the read alone. A composed menu for a session
/// that can never boot again describes nothing, so saying so IS the answer.
pub(super) fn compose_agent_config_options<C, L>(
    session_store: &SessionStore,
    caller_session_id: &str,
    target_session_id: &str,
    resolve_workspace_launch_options: C,
    live_config_snapshot: L,
) -> Result<ComposedAgentConfig, AgentConfigError>
where
    C: FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions>,
    L: FnOnce(&str) -> anyhow::Result<Option<SessionLiveConfigSnapshot>>,
{
    let target = authorize(
        session_store,
        caller_session_id,
        target_session_id,
        AgentAccessIntent::Read,
    )?
    .target;
    if let Some(error) = target_config_is_unreachable(&target) {
        return Err(error);
    }
    compose(
        target,
        resolve_workspace_launch_options,
        live_config_snapshot,
    )
}

/// Gate + compose + validate a change. Everything here is read-only: the
/// admission permit and the apply come after, at the call site, so a refusal
/// never costs a permit.
pub(super) fn prepare_agent_config_change<C, L>(
    session_store: &SessionStore,
    caller_session_id: &str,
    target_session_id: &str,
    config_id: &str,
    value: &str,
    resolve_workspace_launch_options: C,
    live_config_snapshot: L,
) -> Result<PreparedConfigChange, AgentConfigError>
where
    C: FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions>,
    L: FnOnce(&str) -> anyhow::Result<Option<SessionLiveConfigSnapshot>>,
{
    let config_id = config_id.trim();
    if config_id.is_empty() {
        return Err(AgentConfigError::EmptyConfigId);
    }
    let value = value.trim();
    if value.is_empty() {
        return Err(AgentConfigError::EmptyValue);
    }
    // Send intent, not Read: this reaches the target's actor, so the funnel
    // decides self/closed/dismissed/internal-only; nothing is
    // re-decided here. Only the wording of the self refusal is config-specific
    // — the funnel's message talks about messaging.
    let target = authorize(
        session_store,
        caller_session_id,
        target_session_id,
        AgentAccessIntent::Send,
    )
    .map_err(|error| match error {
        AgentAccessError::SelfTarget => AgentConfigError::SelfTarget,
        other => AgentConfigError::Access(other),
    })?
    .target;
    let composed = compose(
        target,
        resolve_workspace_launch_options,
        live_config_snapshot,
    )?;
    validate_change(&composed, config_id, value)?;
    Ok(PreparedConfigChange {
        target: composed.target,
        config_id: config_id.to_string(),
        value: value.to_string(),
    })
}

fn compose<C, L>(
    target: SessionRecord,
    resolve_workspace_launch_options: C,
    live_config_snapshot: L,
) -> Result<ComposedAgentConfig, AgentConfigError>
where
    C: FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions>,
    L: FnOnce(&str) -> anyhow::Result<Option<SessionLiveConfigSnapshot>>,
{
    // The TARGET's workspace. Composing the caller's would advertise models
    // that the target's machine/auth contexts may not serve at all.
    let catalog = resolve_workspace_launch_options(&target.workspace_id)?;
    let live_config = live_config_snapshot(&target.id)?;
    let controls = compose_controls(&target, &catalog, live_config.as_ref());
    Ok(ComposedAgentConfig {
        catalog_workspace_id: target.workspace_id.clone(),
        target,
        controls,
        live_config,
    })
}

fn compose_controls(
    target: &SessionRecord,
    catalog: &ResolvedWorkspaceLaunchOptions,
    live_config: Option<&SessionLiveConfigSnapshot>,
) -> Vec<ComposedControl> {
    let mut controls: Vec<ComposedControl> = Vec::new();

    if let Some(snapshot) = live_config {
        let normalized = &snapshot.normalized_controls;
        for control in [
            normalized.model.as_ref(),
            normalized.collaboration_mode.as_ref(),
            normalized.mode.as_ref(),
            normalized.reasoning.as_ref(),
            normalized.effort.as_ref(),
            normalized.fast_mode.as_ref(),
        ]
        .into_iter()
        .flatten()
        .chain(normalized.extras.iter())
        {
            push_control(&mut controls, from_normalized(control));
        }
        // Raw options the normalizer did not claim under any key still take a
        // configId — the apply path routes on the raw id, so anything the
        // harness advertises stays reachable.
        for option in &snapshot.raw_config_options {
            let mut control = ComposedControl {
                config_id: option.id.clone(),
                key: option.category.clone(),
                label: option.name.clone(),
                current_value: Some(option.current_value.clone()),
                values: Vec::new(),
            };
            for value in &option.options {
                control.push_value(value.value.clone(), value.name.clone(), VALUE_SOURCE_LIVE);
            }
            push_control(&mut controls, control);
        }
    }

    // The model universe the TARGET's workspace can serve. This is what makes
    // a model switch legal even when the harness advertises a shorter list (or
    // none at all, on a session that has never run): the apply path itself
    // authorizes catalog models and relaunches when the live actor refuses.
    let model_config_id = live_config
        .and_then(|snapshot| snapshot.normalized_controls.model.as_ref())
        .map(|control| control.raw_config_id.clone())
        .unwrap_or_else(|| ACP_MODEL_COMPAT_CONFIG_ID.to_string());
    let model_index = match controls
        .iter()
        .position(|control| control.config_id == model_config_id)
    {
        Some(index) => index,
        None => {
            controls.insert(
                0,
                ComposedControl {
                    config_id: model_config_id,
                    key: Some("model".to_string()),
                    label: "Model".to_string(),
                    current_value: target
                        .current_model_id
                        .clone()
                        .or_else(|| target.requested_model_id.clone()),
                    values: Vec::new(),
                },
            );
            0
        }
    };
    if let Some(agent) = catalog
        .agents
        .iter()
        .find(|agent| agent.kind == target.agent_kind)
    {
        let control = &mut controls[model_index];
        for model in &agent.models {
            control.push_value(
                model.id.clone(),
                model.display_name.clone(),
                VALUE_SOURCE_WORKSPACE_CATALOG,
            );
            for alias in &model.aliases {
                control.push_value(
                    alias.clone(),
                    model.display_name.clone(),
                    VALUE_SOURCE_WORKSPACE_CATALOG,
                );
            }
        }
    }

    controls
}

fn from_normalized(control: &NormalizedSessionControl) -> ComposedControl {
    let mut composed = ComposedControl {
        config_id: control.raw_config_id.clone(),
        key: Some(control.key.clone()),
        label: control.label.clone(),
        current_value: control.current_value.clone(),
        values: Vec::new(),
    };
    for value in &control.values {
        composed.push_value(value.value.clone(), value.label.clone(), VALUE_SOURCE_LIVE);
    }
    composed
}

fn push_control(controls: &mut Vec<ComposedControl>, control: ComposedControl) {
    if let Some(existing) = controls
        .iter_mut()
        .find(|existing| existing.config_id == control.config_id)
    {
        for value in control.values {
            existing.push_value(value.value, value.label, value.source);
        }
        return;
    }
    controls.push(control);
}

fn validate_change(
    composed: &ComposedAgentConfig,
    config_id: &str,
    value: &str,
) -> Result<(), AgentConfigError> {
    let Some(control) = composed.control(config_id) else {
        return Err(AgentConfigError::UnknownConfigId {
            session_id: composed.target.id.clone(),
            config_id: config_id.to_string(),
            available: composed.config_ids(),
        });
    };
    if !control
        .values
        .iter()
        .any(|candidate| candidate.value == value)
    {
        return Err(AgentConfigError::ValueNotAvailable {
            session_id: composed.target.id.clone(),
            config_id: config_id.to_string(),
            value: value.to_string(),
            available: join_quoted(control.values.iter().map(|value| value.value.as_str())),
        });
    }
    // Value-membership first, so a bogus value still gets the precise "here is
    // what IS available" error. Only a value that would have been accepted can
    // reach the settability check, and by then the only way to fail it is the
    // no-op: the one value on offer is already current.
    if !control.settable() {
        return Err(AgentConfigError::ControlNotSettable {
            session_id: composed.target.id.clone(),
            config_id: config_id.to_string(),
            value: value.to_string(),
        });
    }
    Ok(())
}

fn join_quoted<'a>(values: impl Iterator<Item = &'a str>) -> String {
    let joined = values
        .map(|value| format!("{value:?}"))
        .collect::<Vec<_>>()
        .join(", ");
    if joined.is_empty() {
        "(none)".to_string()
    } else {
        joined
    }
}

/// The READ path's copy of the two terminal states the `Send` funnel already
/// refuses (`authorize::authorize`). Reading a config is the one read that a
/// terminal session cannot answer, so the read path takes the same decision
/// deliberately rather than composing a menu nobody can apply.
///
/// `is_closed` is the funnel's own predicate, shared so "closed" means one
/// thing everywhere; dismissed is checked here the same way the funnel checks
/// it, off `dismissed_at`.
fn target_config_is_unreachable(session: &SessionRecord) -> Option<AgentConfigError> {
    if authorize::is_closed(session) {
        Some(AgentConfigError::TargetClosed)
    } else if session.dismissed_at.is_some() {
        Some(AgentConfigError::TargetDismissed)
    } else {
        None
    }
}

pub(super) fn controls_to_json(controls: &[ComposedControl]) -> Vec<Value> {
    controls
        .iter()
        .map(|control| {
            json!({
                "configId": control.config_id,
                "key": control.key,
                "label": control.label,
                "currentValue": control.current_value,
                "settable": control.settable(),
                "values": control.values.iter().map(|value| json!({
                    "value": value.value,
                    "label": value.label,
                    "source": value.source,
                })).collect::<Vec<_>>(),
            })
        })
        .collect()
}

/// What the target's row currently records. The live snapshot is the truth for
/// a running agent; this is what a relaunch would converge back to.
pub(super) fn current_selection_to_json(target: &SessionRecord) -> Value {
    json!({
        "modelId": target.current_model_id.clone().or_else(|| target.requested_model_id.clone()),
        "requestedModelId": target.requested_model_id,
        "modeId": target.current_mode_id.clone().or_else(|| target.requested_mode_id.clone()),
        "requestedModeId": target.requested_mode_id,
        "thinkingLevelId": target.thinking_level_id,
        "thinkingBudgetTokens": target.thinking_budget_tokens,
    })
}

#[cfg(test)]
#[path = "config_ops_tests.rs"]
mod tests;
