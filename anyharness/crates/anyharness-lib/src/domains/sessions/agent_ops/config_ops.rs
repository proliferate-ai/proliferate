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
use crate::domains::sessions::authorize::{authorize, AgentAccessError, AgentAccessIntent};
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
    #[error(
        "target session is closed; a closed agent has no configuration left to read or change"
    )]
    TargetClosed,
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
    fn settable(&self) -> bool {
        self.values.len() > 1
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

/// Gate + compose a read. Any authorized caller may look at any open session's
/// controls; a closed target is refused rather than answered with an empty menu.
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
    if target_is_closed(&target) {
        return Err(AgentConfigError::TargetClosed);
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
    if control
        .values
        .iter()
        .any(|candidate| candidate.value == value)
    {
        return Ok(());
    }
    Err(AgentConfigError::ValueNotAvailable {
        session_id: composed.target.id.clone(),
        config_id: config_id.to_string(),
        value: value.to_string(),
        available: join_quoted(control.values.iter().map(|value| value.value.as_str())),
    })
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

/// Local copy of `authorize::is_closed`, which is private to that module. The
/// funnel already refuses a closed target for `Send`; only the READ path needs
/// this, and only because reading a config is the one read that a closed
/// session cannot answer. Collapse the two if that predicate is ever exported.
fn target_is_closed(session: &SessionRecord) -> bool {
    session.closed_at.is_some() || session.status == "closed"
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
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::agents::readiness::launch_options::{
        ResolvedLaunchAgentOption, ResolvedLaunchModelOption,
    };
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::persistence::Db;
    use anyharness_contract::v1::{
        NormalizedSessionControl, NormalizedSessionControlValue, NormalizedSessionControls,
        PromptCapabilities,
    };
    use std::cell::RefCell;

    fn session_record(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn store_fixture() -> SessionStore {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-2",
            "local",
            "/tmp/workspace-2",
        );
        let store = SessionStore::new(db);
        store
            .insert(&session_record("ses_caller", "workspace-1"))
            .expect("insert caller");
        store
            .insert(&session_record("ses_target", "workspace-2"))
            .expect("insert target");
        store
    }

    fn model_option(id: &str) -> ResolvedLaunchModelOption {
        ResolvedLaunchModelOption {
            id: id.to_string(),
            display_name: id.to_string(),
            aliases: Vec::new(),
            is_default: false,
            default_opt_in: None,
            description: None,
            provider: None,
            status: None,
            effort: None,
            live_effort_candidates: Vec::new(),
            fast_mode: false,
            modes: None,
        }
    }

    fn catalog(model_ids: &[&str]) -> ResolvedWorkspaceLaunchOptions {
        ResolvedWorkspaceLaunchOptions {
            agents: vec![ResolvedLaunchAgentOption {
                kind: "claude".to_string(),
                display_name: "Claude".to_string(),
                default_model_id: model_ids.first().map(|id| (*id).to_string()),
                unattended_mode_id: None,
                models: model_ids.iter().map(|id| model_option(id)).collect(),
            }],
        }
    }

    fn snapshot_with_mode(mode_ids: &[&str]) -> SessionLiveConfigSnapshot {
        SessionLiveConfigSnapshot {
            raw_config_options: Vec::new(),
            normalized_controls: NormalizedSessionControls {
                mode: Some(NormalizedSessionControl {
                    key: "mode".to_string(),
                    raw_config_id: "mode".to_string(),
                    label: "Mode".to_string(),
                    current_value: mode_ids.first().map(|id| (*id).to_string()),
                    settable: mode_ids.len() > 1,
                    values: mode_ids
                        .iter()
                        .map(|id| NormalizedSessionControlValue {
                            value: (*id).to_string(),
                            label: (*id).to_string(),
                            description: None,
                        })
                        .collect(),
                }),
                ..Default::default()
            },
            prompt_capabilities: PromptCapabilities::default(),
            source_seq: 1,
            updated_at: "2026-08-08T00:00:00Z".to_string(),
        }
    }

    /// Records which workspace id the composition asked the catalog about.
    struct CatalogSpy {
        asked: RefCell<Vec<String>>,
    }

    impl CatalogSpy {
        fn new() -> Self {
            Self {
                asked: RefCell::new(Vec::new()),
            }
        }

        fn resolver(
            &self,
        ) -> impl FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> + '_ {
            move |workspace_id: &str| {
                self.asked.borrow_mut().push(workspace_id.to_string());
                // Deliberately different menus per workspace: composing the
                // wrong one is then visible in the result, not just in the spy.
                Ok(match workspace_id {
                    "workspace-1" => catalog(&["caller-only-model"]),
                    "workspace-2" => catalog(&["target-only-model", "target-second-model"]),
                    _ => catalog(&[]),
                })
            }
        }
    }

    fn no_live_config(_session_id: &str) -> anyhow::Result<Option<SessionLiveConfigSnapshot>> {
        Ok(None)
    }

    #[test]
    fn options_for_a_target_in_another_workspace_come_from_the_targets_catalog() {
        let store = store_fixture();
        let spy = CatalogSpy::new();

        let composed = compose_agent_config_options(
            &store,
            "ses_caller",
            "ses_target",
            spy.resolver(),
            no_live_config,
        )
        .expect("compose options");

        // The caller lives in workspace-1; the target in workspace-2.
        assert_eq!(spy.asked.borrow().as_slice(), ["workspace-2"]);
        assert_eq!(composed.catalog_workspace_id, "workspace-2");
        let model = composed.control("model").expect("model control");
        let values = model
            .values
            .iter()
            .map(|value| value.value.as_str())
            .collect::<Vec<_>>();
        assert_eq!(values, ["target-only-model", "target-second-model"]);
        assert!(!values.contains(&"caller-only-model"));
    }

    #[test]
    fn a_model_only_the_callers_workspace_offers_is_rejected() {
        // The other half of the same guarantee: composing the caller's catalog
        // would make this succeed.
        let store = store_fixture();
        let spy = CatalogSpy::new();

        let error = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "model",
            "caller-only-model",
            spy.resolver(),
            no_live_config,
        )
        .err()
        .expect("a caller-workspace model is not in the target's universe");

        assert!(matches!(
            error,
            AgentConfigError::ValueNotAvailable { ref value, .. } if value == "caller-only-model"
        ));
        assert_eq!(spy.asked.borrow().as_slice(), ["workspace-2"]);
    }

    #[test]
    fn a_model_the_targets_workspace_offers_is_accepted() {
        let store = store_fixture();
        let spy = CatalogSpy::new();

        let prepared = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "model",
            "target-only-model",
            spy.resolver(),
            no_live_config,
        )
        .expect("target-workspace model is accepted");

        assert_eq!(prepared.target.id, "ses_target");
        assert_eq!(prepared.config_id, "model");
        assert_eq!(prepared.value, "target-only-model");
    }

    #[test]
    fn an_unknown_config_id_names_what_is_available() {
        let store = store_fixture();
        let spy = CatalogSpy::new();

        let error = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "telepathy",
            "on",
            spy.resolver(),
            no_live_config,
        )
        .err()
        .expect("unknown configId is rejected");

        assert!(matches!(
            error,
            AgentConfigError::UnknownConfigId { ref config_id, .. } if config_id == "telepathy"
        ));
        assert!(error.to_string().contains("\"model\""));
    }

    #[test]
    fn a_value_outside_the_live_controls_universe_is_rejected() {
        let store = store_fixture();
        let spy = CatalogSpy::new();

        let error = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "mode",
            "yolo",
            spy.resolver(),
            |_| Ok(Some(snapshot_with_mode(&["plan", "edit"]))),
        )
        .err()
        .expect("a mode the harness does not advertise is rejected");

        assert!(matches!(
            error,
            AgentConfigError::ValueNotAvailable { ref config_id, .. } if config_id == "mode"
        ));
        assert!(error.to_string().contains("\"plan\""));

        // The same call with an advertised value goes through.
        let spy = CatalogSpy::new();
        prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "mode",
            "edit",
            spy.resolver(),
            |_| Ok(Some(snapshot_with_mode(&["plan", "edit"]))),
        )
        .expect("an advertised mode is accepted");
    }

    #[test]
    fn live_values_and_catalog_models_merge_under_one_model_control() {
        let store = store_fixture();
        let spy = CatalogSpy::new();
        let mut snapshot = snapshot_with_mode(&["plan"]);
        snapshot.normalized_controls.model = Some(NormalizedSessionControl {
            key: "model".to_string(),
            raw_config_id: "model".to_string(),
            label: "Model".to_string(),
            current_value: Some("live-only-model".to_string()),
            settable: false,
            values: vec![NormalizedSessionControlValue {
                value: "live-only-model".to_string(),
                label: "Live only".to_string(),
                description: None,
            }],
        });

        let composed = compose_agent_config_options(
            &store,
            "ses_caller",
            "ses_target",
            spy.resolver(),
            |_| Ok(Some(snapshot)),
        )
        .expect("compose options");

        let model = composed.control("model").expect("model control");
        let sources = model
            .values
            .iter()
            .map(|value| (value.value.as_str(), value.source))
            .collect::<Vec<_>>();
        assert_eq!(
            sources,
            [
                ("live-only-model", VALUE_SOURCE_LIVE),
                ("target-only-model", VALUE_SOURCE_WORKSPACE_CATALOG),
                ("target-second-model", VALUE_SOURCE_WORKSPACE_CATALOG),
            ]
        );
        assert_eq!(model.current_value.as_deref(), Some("live-only-model"));
    }

    #[test]
    fn a_closed_target_is_refused_for_both_reads_and_changes() {
        let store = store_fixture();
        let mut closed = session_record("ses_closed", "workspace-2");
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        store.insert(&closed).expect("insert closed target");

        let read = compose_agent_config_options(
            &store,
            "ses_caller",
            "ses_closed",
            CatalogSpy::new().resolver(),
            no_live_config,
        )
        .err()
        .expect("closed target has no options to read");
        assert!(matches!(read, AgentConfigError::TargetClosed));

        let change = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_closed",
            "model",
            "target-only-model",
            CatalogSpy::new().resolver(),
            no_live_config,
        )
        .err()
        .expect("closed target takes no changes");
        assert!(matches!(
            change,
            AgentConfigError::Access(AgentAccessError::TargetClosed)
        ));
    }

    #[test]
    fn the_caller_cannot_configure_itself() {
        let store = store_fixture();

        let error = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_caller",
            "model",
            "caller-only-model",
            CatalogSpy::new().resolver(),
            no_live_config,
        )
        .err()
        .expect("self target is rejected");

        assert!(matches!(error, AgentConfigError::SelfTarget));

        // Reading your own options is harmless and stays allowed.
        compose_agent_config_options(
            &store,
            "ses_caller",
            "ses_caller",
            CatalogSpy::new().resolver(),
            no_live_config,
        )
        .expect("reading your own options is allowed");
    }

    #[test]
    fn blank_arguments_are_rejected_before_any_lookup() {
        let store = store_fixture();
        let spy = CatalogSpy::new();

        let blank_id = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "  ",
            "target-only-model",
            spy.resolver(),
            no_live_config,
        )
        .err()
        .expect("blank configId is rejected");
        assert!(matches!(blank_id, AgentConfigError::EmptyConfigId));

        let spy = CatalogSpy::new();
        let blank_value = prepare_agent_config_change(
            &store,
            "ses_caller",
            "ses_target",
            "model",
            "\n",
            spy.resolver(),
            no_live_config,
        )
        .err()
        .expect("blank value is rejected");
        assert!(matches!(blank_value, AgentConfigError::EmptyValue));
        assert!(spy.asked.borrow().is_empty());
    }

    /// The tests above prove what validation DECIDES; none of them prove
    /// `configure_agent` obeys it, because the apply needs a live actor. Same
    /// source-order guard the send path uses (`peer_ops.rs`), for the same
    /// reason: the order and the arguments ARE the guarantee.
    #[test]
    fn configure_agent_validates_admits_leases_then_applies_the_validated_triple() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/domains/sessions/agent_ops/calls.rs");
        let text = std::fs::read_to_string(&path).expect("read calls.rs");
        let start = text
            .find("async fn configure_agent(")
            .expect("configure_agent is defined in calls.rs");
        let rest = &text[start..];
        let body = &rest[..rest[1..]
            .find("\nasync fn ")
            .or_else(|| rest[1..].find("\nfn "))
            .map_or(rest.len(), |at| at + 1)];

        let prepared_at = body
            .find("prepare_agent_config_change(")
            .expect("configure_agent validates against the target's composed options");
        let admitted_at = body
            .find("admit_peer_mutation(")
            .expect("configure_agent takes the target's session mutation permit");
        let leased_at = body
            .find("lease_target_workspace_for_peer_write(")
            .expect("configure_agent leases the TARGET's workspace, not the route's");
        let applied_at = body
            .find("set_live_session_config_option(")
            .expect("configure_agent applies through the existing runtime path");

        // Validate first: a refusal must not cost a permit or a lease.
        assert!(
            prepared_at < admitted_at,
            "the target's options must be validated BEFORE the admission permit"
        );
        // Canonical order (admission.rs): permit outermost, then the lease.
        assert!(
            admitted_at < leased_at,
            "the session mutation permit must be taken BEFORE any workspace lease"
        );
        assert!(
            leased_at < applied_at,
            "the target workspace lease must be held BEFORE the apply"
        );
        // The apply gets the VALIDATED triple, never the raw arguments: an
        // untrimmed/unvalidated configId or value would bypass the composed
        // universe entirely. Whitespace is stripped from both sides so a
        // reformat that wraps the argument list does not read as a regression.
        let squashed = body
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>();
        assert!(
            squashed.contains(
                "set_live_session_config_option(&prepared.target.id,&prepared.config_id,&prepared.value"
            ),
            "configure_agent must apply the validated target/configId/value, not the raw args"
        );
        assert!(
            body.contains("SessionMutationKind::Config"),
            "the permit must name the Config mutation kind"
        );
        // And the lease is on the TARGET's workspace. The route's lease is the
        // caller's, which for a cross-workspace target is the wrong workspace
        // to hold open against retire.
        assert!(
            squashed.contains("&prepared.target.workspace_id,"),
            "the workspace lease must be taken on the TARGET's workspace"
        );
    }

    #[test]
    fn an_unknown_target_is_named_in_the_error() {
        let store = store_fixture();

        let error = compose_agent_config_options(
            &store,
            "ses_caller",
            "ses_ghost",
            CatalogSpy::new().resolver(),
            no_live_config,
        )
        .err()
        .expect("unknown target is rejected");

        assert!(matches!(
            error,
            AgentConfigError::Access(AgentAccessError::TargetNotFound(ref id)) if id == "ses_ghost"
        ));
    }
}
