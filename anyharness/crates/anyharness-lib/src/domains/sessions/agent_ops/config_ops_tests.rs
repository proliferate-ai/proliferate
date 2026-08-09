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
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    test_support::seed_workspace_with_repo_root(&db, "workspace-2", "local", "/tmp/workspace-2");
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

    fn resolver(&self) -> impl FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> + '_ {
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

    let composed =
        compose_agent_config_options(&store, "ses_caller", "ses_target", spy.resolver(), |_| {
            Ok(Some(snapshot))
        })
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
fn a_dismissed_target_is_refused_for_both_reads_and_changes() {
    // Read and write stay symmetric on the terminal states. The change path
    // was always refused by the `Send` funnel; the READ path refuses too,
    // because a dismissed session is never launched again
    // (`runtime/launch_policy.rs`), so a composed menu for it is a list of
    // changes that can never be applied — advertised, then refused.
    let store = store_fixture();
    let mut dismissed = session_record("ses_dismissed", "workspace-2");
    dismissed.dismissed_at = Some("2026-08-08T01:00:00Z".to_string());
    store.insert(&dismissed).expect("insert dismissed target");

    let spy = CatalogSpy::new();
    let read = compose_agent_config_options(
        &store,
        "ses_caller",
        "ses_dismissed",
        spy.resolver(),
        no_live_config,
    )
    .err()
    .expect("dismissed target has no options to read");
    assert!(matches!(read, AgentConfigError::TargetDismissed));
    // The refusal is about configuration, and it never composed anything to
    // refuse — the catalog was not even consulted.
    assert!(read.to_string().contains("configuration"));
    assert!(spy.asked.borrow().is_empty());

    let change = prepare_agent_config_change(
        &store,
        "ses_caller",
        "ses_dismissed",
        "model",
        "target-only-model",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .err()
    .expect("dismissed target takes no changes");
    assert!(matches!(
        change,
        AgentConfigError::Access(AgentAccessError::TargetDismissed)
    ));

    // Negative control: the same caller and the same catalog DO compose a
    // menu for an ordinary target, so the refusals above are the terminal
    // state and not a blanket block.
    compose_agent_config_options(
        &store,
        "ses_caller",
        "ses_target",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .expect("an ordinary target still reads");
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
fn a_control_reported_unsettable_also_refuses_the_change() {
    // `settable` is what the read advertises; this is the write keeping it.
    // workspace-1's catalog offers exactly one model, and the target has
    // already selected it — so the menu is a dead end and the only value it
    // lists is a no-op.
    let store = store_fixture();
    let mut target = session_record("ses_single", "workspace-1");
    target.current_model_id = Some("caller-only-model".to_string());
    store.insert(&target).expect("insert single-option target");

    let composed = compose_agent_config_options(
        &store,
        "ses_caller",
        "ses_single",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .expect("compose options");
    let model = composed.control("model").expect("model control");
    assert_eq!(model.values.len(), 1);
    assert!(!model.settable(), "the only value is already current");

    let error = prepare_agent_config_change(
        &store,
        "ses_caller",
        "ses_single",
        "model",
        "caller-only-model",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .err()
    .expect("re-asserting the only value is refused, not silently applied");
    assert!(matches!(
        error,
        AgentConfigError::ControlNotSettable { ref config_id, .. } if config_id == "model"
    ));

    // A value that is not on the menu at all still gets the more specific
    // "here is what IS available" error, not this one.
    let unknown_value = prepare_agent_config_change(
        &store,
        "ses_caller",
        "ses_single",
        "model",
        "target-only-model",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .err()
    .expect("an off-menu value is refused");
    assert!(matches!(
        unknown_value,
        AgentConfigError::ValueNotAvailable { .. }
    ));
}

#[test]
fn a_single_value_control_is_settable_while_it_is_not_current() {
    // The legitimate single-value change: the harness offers one option the
    // session has not selected yet, so applying it moves something. A
    // blanket `values.len() > 1` rule would have refused this.
    let store = store_fixture();
    let target = session_record("ses_unselected", "workspace-1");
    store.insert(&target).expect("insert target");

    let composed = compose_agent_config_options(
        &store,
        "ses_caller",
        "ses_unselected",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .expect("compose options");
    let model = composed.control("model").expect("model control");
    assert_eq!(model.values.len(), 1);
    assert_eq!(model.current_value, None);
    assert!(model.settable(), "one value, none selected yet");

    prepare_agent_config_change(
        &store,
        "ses_caller",
        "ses_unselected",
        "model",
        "caller-only-model",
        CatalogSpy::new().resolver(),
        no_live_config,
    )
    .expect("selecting the one option for the first time is a real change");
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
    // The window ends at whichever item header comes FIRST. Taking the
    // `async fn` position and only falling back to `fn` when there is none
    // would swallow every plain `fn` in between, widening the window past
    // this function and letting an out-of-order call in a later one satisfy
    // the assertions below.
    let after = &rest[1..];
    let end = [after.find("\nasync fn "), after.find("\nfn ")]
        .into_iter()
        .flatten()
        .min()
        .map_or(rest.len(), |at| at + 1);
    let body = &rest[..end];
    // Whitespace runs collapse to one space so the needles can span a `let`
    // binding without a rustfmt wrap breaking them.
    let squashed = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let squashed = squashed.as_str();

    let prepared_at = squashed
        .find("prepare_agent_config_change(")
        .expect("configure_agent validates against the target's composed options");
    // Pin the BINDING, not the call: `let _ = admit_peer_mutation(..)` drops
    // the permit at the end of its own statement, and is indistinguishable
    // from a held one if only the call substring is matched. Order alone is
    // not the guarantee — the guards have to still be HELD at the apply.
    let admitted_at = squashed
        .find("let _admission_permit = admit_peer_mutation(")
        .expect(
            "configure_agent must BIND the target's session mutation permit as \
             `_admission_permit`; an unbound `let _ =` drops it immediately",
        );
    let leased_at = squashed
        .find("let _target_workspace_lease = lease_target_workspace_for_peer_write(")
        .expect(
            "configure_agent must BIND the TARGET workspace lease as \
             `_target_workspace_lease`; an unbound `let _ =` drops it immediately",
        );
    let applied_at = squashed
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
    // universe entirely. Whitespace is stripped entirely from both sides so
    // a reformat that wraps the argument list does not read as a regression.
    let tight = body
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();
    assert!(
        tight.contains(
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
        tight.contains("&prepared.target.workspace_id,"),
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
