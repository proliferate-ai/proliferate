use super::*;
use crate::app::test_support;
use crate::domains::agents::readiness::launch_options::{
    ResolvedLaunchAgentOption, ResolvedLaunchModelOption,
};
use crate::domains::sessions::admission::{NoControllerPolicy, SessionMutationAdmission};
use crate::domains::sessions::agent_ops::peer_ops::consume_reply_wake;
use crate::domains::sessions::agent_ops::tools::SpawnAgentArgs;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;
use serde_json::json;
use std::sync::Arc;

fn session(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: Some("requested-model".to_string()),
        current_model_id: Some("current-model".to_string()),
        requested_mode_id: Some("requested-mode".to_string()),
        current_mode_id: Some("current-mode".to_string()),
        title: Some("Schema audit".to_string()),
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

fn link(relation: SessionLinkRelation) -> SessionLinkRecord {
    use crate::domains::sessions::links::model::SessionLinkWorkspaceRelation;
    SessionLinkRecord {
        id: "link-1".to_string(),
        public_id: Some("subagent_abc".to_string()),
        relation,
        parent_session_id: "ses_caller".to_string(),
        child_session_id: "ses_child".to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some("API surface check".to_string()),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-08T00:00:00Z".to_string(),
        closed_at: None,
        promoted_at: None,
        closed_by_session_id: None,
        close_reason: None,
    }
}

fn subagent_args() -> CreateSubagentArgs {
    CreateSubagentArgs {
        prompt: "Audit the schema".to_string(),
        label: Some("  API surface check  ".to_string()),
        harness_id: None,
        initial_config: None,
        wake_on_completion: true,
    }
}

fn spawn_agent_args() -> SpawnAgentArgs {
    SpawnAgentArgs {
        prompt: "Audit the schema".to_string(),
        label: Some("  API surface check  ".to_string()),
        harness_id: None,
        initial_config: None,
        wake_on_completion: true,
        workspace_id: None,
    }
}

/// The equivalence the refactor rests on. Every field `spawn_subagent`
/// used to compute inline is computed here now, so this is what would
/// catch a passthrough quietly going missing in the move.
#[test]
fn a_subagent_request_inherits_the_parent_and_carries_the_wake_flag_through() {
    let request = CreateAgentSessionRequest::subagent(&session("ses_caller"), subagent_args())
        .expect("build request");

    assert_eq!(request.ownership, AgentSessionOwnership::Subagent);
    assert_eq!(request.workspace_id, "workspace-1");
    assert_eq!(request.agent_kind, "claude");
    assert_eq!(request.model_id.as_deref(), Some("current-model"));
    assert_eq!(request.mode_id.as_deref(), Some("current-mode"));
    assert_eq!(request.label.as_deref(), Some("API surface check"));
    assert_eq!(request.prompt, "Audit the schema");
    assert!(
        request.wake_on_completion,
        "wakeOnCompletion must survive the arg-to-request mapping, or a spawn that asked to \
         be woken silently is not"
    );
    // A subagent may not spawn: ruling 3's durable half.
    assert!(!request.child_subagents_enabled());
}

#[test]
fn explicit_launch_choices_beat_inheritance_and_a_blank_label_is_dropped() {
    let args = CreateSubagentArgs {
        prompt: "Audit the schema".to_string(),
        label: Some("   ".to_string()),
        harness_id: Some("codex".to_string()),
        initial_config: Some(json!({ "modelId": "gpt-5", "modeId": "plan" })),
        wake_on_completion: false,
    };

    let request = CreateAgentSessionRequest::subagent(&session("ses_caller"), args).expect("build");

    assert_eq!(request.agent_kind, "codex");
    assert_eq!(request.model_id.as_deref(), Some("gpt-5"));
    assert_eq!(request.mode_id.as_deref(), Some("plan"));
    assert_eq!(request.label, None);
    assert!(!request.wake_on_completion);
}

#[test]
fn a_parent_with_no_current_values_falls_back_to_what_it_requested() {
    let mut parent = session("ses_caller");
    parent.current_model_id = None;
    parent.current_mode_id = None;

    let request =
        CreateAgentSessionRequest::subagent(&parent, subagent_args()).expect("build request");

    assert_eq!(request.model_id.as_deref(), Some("requested-model"));
    assert_eq!(request.mode_id.as_deref(), Some("requested-mode"));
}

#[test]
fn an_owned_agent_inherits_the_same_way_but_is_born_able_to_spawn() {
    let request =
        CreateAgentSessionRequest::owned_agent(&session("ses_caller"), spawn_agent_args())
            .expect("build request");

    assert_eq!(request.ownership, AgentSessionOwnership::OwnedAgent);
    assert_eq!(request.agent_kind, "claude");
    assert_eq!(request.model_id.as_deref(), Some("current-model"));
    assert_eq!(request.label.as_deref(), Some("API surface check"));
    assert!(request.wake_on_completion);
    // Never "unpromoted": it has the full surface from birth (ADR §3.4).
    assert!(request.child_subagents_enabled());
}

#[test]
fn neither_spawn_accepts_an_empty_prompt() {
    for blank in ["", "   ", "\n\t"] {
        assert!(CreateAgentSessionRequest::subagent(
            &session("ses_caller"),
            CreateSubagentArgs {
                prompt: blank.to_string(),
                ..subagent_args()
            },
        )
        .is_err());
        assert!(CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                prompt: blank.to_string(),
                ..spawn_agent_args()
            },
        )
        .is_err());
    }
}

#[test]
fn spawn_agent_lands_the_peer_in_the_workspace_it_was_given() {
    let caller = session("ses_caller");

    let same = CreateAgentSessionRequest::owned_agent(
        &caller,
        SpawnAgentArgs {
            workspace_id: Some("  workspace-1  ".to_string()),
            ..spawn_agent_args()
        },
    )
    .expect("naming your own workspace is fine");
    assert_eq!(same.workspace_id, "workspace-1");
    assert!(!same.is_cross_workspace(&caller));

    // The other half of ADR §5 flow 4: `spawn_workspace` makes a workspace,
    // and this is the tool that puts an agent in it. Refusing here (as the
    // pre-`spawn_workspace` build did) would leave the new workspace with
    // no way to get an agent into it.
    let elsewhere = CreateAgentSessionRequest::owned_agent(
        &caller,
        SpawnAgentArgs {
            workspace_id: Some("workspace-2".to_string()),
            ..spawn_agent_args()
        },
    )
    .expect("another workspace is allowed");
    assert_eq!(elsewhere.workspace_id, "workspace-2");
    assert!(elsewhere.is_cross_workspace(&caller));

    // Omitted still means "here".
    let defaulted =
        CreateAgentSessionRequest::owned_agent(&caller, spawn_agent_args()).expect("build");
    assert_eq!(defaulted.workspace_id, "workspace-1");
}

#[test]
fn a_subagent_is_pinned_to_the_callers_workspace_with_no_way_to_ask_otherwise() {
    // Ruling: subagents stay own-workspace only (ADR §5 flow 4). The tool
    // takes no workspace argument at all, so this pins the derivation.
    let request = CreateAgentSessionRequest::subagent(&session("ses_caller"), subagent_args())
        .expect("build request");

    assert_eq!(request.workspace_id, "workspace-1");
    assert!(!request.is_cross_workspace(&session("ses_caller")));
}

// --- launch validation against the TARGET workspace (ADR §5 flow 4) ---

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

/// A model that declares a mode control, which is the only case a mode can
/// be checked against. `modes: None` on `model_option` is the other case,
/// and it is a real one — see the pass-through test below.
fn model_option_offering(id: &str, modes: &[&str]) -> ResolvedLaunchModelOption {
    ResolvedLaunchModelOption {
        modes: Some(modes.iter().map(|mode| (*mode).to_string()).collect()),
        ..model_option(id)
    }
}

fn agent_option(kind: &str, model_ids: &[&str]) -> ResolvedLaunchAgentOption {
    ResolvedLaunchAgentOption {
        kind: kind.to_string(),
        display_name: kind.to_string(),
        default_model_id: model_ids.first().map(|id| (*id).to_string()),
        unattended_mode_id: None,
        models: model_ids.iter().map(|id| model_option(id)).collect(),
    }
}

fn agent_option_offering(
    kind: &str,
    model_id: &str,
    modes: &[&str],
    unattended_mode_id: Option<&str>,
) -> ResolvedLaunchAgentOption {
    ResolvedLaunchAgentOption {
        unattended_mode_id: unattended_mode_id.map(ToString::to_string),
        models: vec![model_option_offering(model_id, modes)],
        ..agent_option(kind, &[model_id])
    }
}

/// Records which workspace id the launch resolution asked the catalog
/// about, and answers with deliberately DISJOINT menus per workspace, so
/// composing the wrong one is visible in the outcome and not only in the
/// spy. Same shape as `config_ops`' spy, for the same guarantee.
struct CatalogSpy {
    asked: std::cell::RefCell<Vec<String>>,
}

impl CatalogSpy {
    fn new() -> Self {
        Self {
            asked: std::cell::RefCell::new(Vec::new()),
        }
    }

    fn resolver(&self) -> impl FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> + '_ {
        move |workspace_id: &str| {
            self.asked.borrow_mut().push(workspace_id.to_string());
            Ok(ResolvedWorkspaceLaunchOptions {
                agents: match workspace_id {
                    "workspace-1" => vec![agent_option_offering(
                        "claude",
                        "caller-only-model",
                        &["caller-only-mode"],
                        Some("caller-only-mode"),
                    )],
                    "workspace-2" => vec![
                        agent_option_offering(
                            "claude",
                            "target-only-model",
                            &["target-only-mode"],
                            Some("target-only-mode"),
                        ),
                        // No mode control at all, which is the arm that
                        // has nothing to check a mode against.
                        agent_option("codex", &["target-codex-model"]),
                    ],
                    _ => Vec::new(),
                },
            })
        }
    }
}

fn cross_workspace_request() -> CreateAgentSessionRequest {
    CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            workspace_id: Some("workspace-2".to_string()),
            ..spawn_agent_args()
        },
    )
    .expect("build request")
}

#[test]
fn the_launch_selection_is_resolved_against_the_target_workspace_not_the_caller() {
    let spy = CatalogSpy::new();
    let mut request = cross_workspace_request();
    // Inherited from the caller, whose workspace is the only place that
    // model exists.
    assert_eq!(request.model_id.as_deref(), Some("current-model"));
    assert!(!request.model_id_explicit);

    resolve_launch_against_target_workspace(&mut request, spy.resolver())
        .expect("an inherited model the target lacks falls back, it does not fail");

    // The whole point: workspace-2, never workspace-1.
    assert_eq!(spy.asked.borrow().as_slice(), ["workspace-2"]);
    // And it landed on the TARGET's default, not the caller's model and not
    // the caller workspace's default.
    assert_eq!(request.model_id.as_deref(), Some("target-only-model"));
    assert_ne!(request.model_id.as_deref(), Some("caller-only-model"));
    // The mode is the third selection and follows the same rule: inherited,
    // not offered there, so it becomes the target harness's curated default
    // rather than travelling across as-is.
    assert_eq!(request.mode_id.as_deref(), Some("target-only-mode"));
}

#[test]
fn a_mode_only_the_callers_workspace_offers_is_refused_when_the_caller_named_it() {
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            workspace_id: Some("workspace-2".to_string()),
            initial_config: Some(
                json!({ "modelId": "target-only-model", "modeId": "caller-only-mode" }),
            ),
            ..spawn_agent_args()
        },
    )
    .expect("build request");
    assert!(request.mode_id_explicit);

    let error = resolve_launch_against_target_workspace(&mut request, spy.resolver())
        .err()
        .expect("a named mode outside the target's menu is refused");

    let message = error.to_string();
    assert!(message.contains("caller-only-mode"), "{message}");
    // The refusal names what IS offered there, so the agent can retry.
    assert!(message.contains("target-only-mode"), "{message}");
}

#[test]
fn a_mode_the_target_workspace_offers_is_kept_verbatim() {
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            workspace_id: Some("workspace-2".to_string()),
            initial_config: Some(
                json!({ "modelId": "target-only-model", "modeId": "target-only-mode" }),
            ),
            ..spawn_agent_args()
        },
    )
    .expect("build request");

    resolve_launch_against_target_workspace(&mut request, spy.resolver()).expect("accepted");

    assert_eq!(request.mode_id.as_deref(), Some("target-only-mode"));
}

#[test]
fn a_model_with_no_mode_control_has_nothing_to_check_the_mode_against() {
    // `modes: None` is "this model declares no mode control", not "no modes
    // are allowed". Refusing there would name an empty list, so the caller's
    // mode is passed through — the same asymmetry the empty catalog has.
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            harness_id: Some("codex".to_string()),
            workspace_id: Some("workspace-2".to_string()),
            initial_config: Some(json!({ "modeId": "anything-at-all" })),
            ..spawn_agent_args()
        },
    )
    .expect("build request");

    resolve_launch_against_target_workspace(&mut request, spy.resolver())
        .expect("a model with no mode control decides nothing about the mode");

    assert_eq!(request.mode_id.as_deref(), Some("anything-at-all"));
}

#[test]
fn a_model_only_the_callers_workspace_offers_is_refused_when_the_caller_named_it() {
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            workspace_id: Some("workspace-2".to_string()),
            initial_config: Some(json!({ "modelId": "caller-only-model" })),
            ..spawn_agent_args()
        },
    )
    .expect("build request");
    assert!(request.model_id_explicit);

    let error = resolve_launch_against_target_workspace(&mut request, spy.resolver())
        .err()
        .expect("a named model outside the target's catalog is refused");

    assert!(error.to_string().contains("caller-only-model"));
    // Resolving against the caller's catalog would have accepted it.
    assert_eq!(spy.asked.borrow().as_slice(), ["workspace-2"]);
}

#[test]
fn a_model_the_target_workspace_offers_is_kept_verbatim() {
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            workspace_id: Some("workspace-2".to_string()),
            initial_config: Some(json!({ "modelId": "target-only-model" })),
            ..spawn_agent_args()
        },
    )
    .expect("build request");

    resolve_launch_against_target_workspace(&mut request, spy.resolver()).expect("accepted");

    assert_eq!(request.model_id.as_deref(), Some("target-only-model"));
}

#[test]
fn a_harness_the_target_cannot_launch_is_refused_and_names_what_it_can() {
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            harness_id: Some("grok".to_string()),
            workspace_id: Some("workspace-2".to_string()),
            ..spawn_agent_args()
        },
    )
    .expect("build request");

    let error = resolve_launch_against_target_workspace(&mut request, spy.resolver())
        .err()
        .expect("an unlaunchable harness is refused");

    let message = error.to_string();
    assert!(message.contains("grok"));
    assert!(message.contains("claude"));
    assert!(message.contains("codex"));
}

#[test]
fn a_workspace_whose_catalog_resolves_to_nothing_is_passed_through() {
    // No launchable agents means readiness could not be established here,
    // not that the request is wrong. Refusing would name nothing.
    let spy = CatalogSpy::new();
    let mut request = CreateAgentSessionRequest::owned_agent(
        &session("ses_caller"),
        SpawnAgentArgs {
            workspace_id: Some("workspace-unknown".to_string()),
            ..spawn_agent_args()
        },
    )
    .expect("build request");

    resolve_launch_against_target_workspace(&mut request, spy.resolver())
        .expect("an empty catalog decides nothing");

    assert_eq!(request.agent_kind, "claude");
    assert_eq!(request.model_id.as_deref(), Some("current-model"));
}

#[test]
fn the_real_resolver_is_handed_the_target_workspace_too() {
    // The spy tests above pin the ROUTINE. This pins the one call site that
    // feeds it: `create_agent_session` has both the caller and the request
    // in scope, and passing `caller.workspace_id` would compile, pass every
    // test above, and quietly compose a cross-workspace spawn against the
    // wrong catalog.
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/domains/sessions/agent_ops/spawn_ops.rs"),
    )
    .expect("read spawn_ops.rs");
    let body = source
        .split_once("pub(super) async fn create_agent_session(")
        .expect("create_agent_session exists")
        .1;
    let body = body
        .split_once("\npub ")
        .map(|(head, _)| head)
        .unwrap_or(body);
    let call = body
        .split_once("resolve_launch_against_target_workspace(")
        .expect("create_agent_session must resolve the launch selection first")
        .1;
    let call = &call[..call.find("})?;").expect("closure ends") + 4];
    assert!(
        call.contains("session_runtime.resolved_workspace_launch_options(workspace_id)"),
        "create_agent_session must resolve against the workspace the routine names — the \
         TARGET's"
    );
    assert!(
        !call.contains("caller."),
        "create_agent_session must not resolve the launch selection against the CALLER's \
         workspace: the target authorizes its own harnesses and models"
    );
}

#[test]
fn the_ownership_mode_picks_the_relation_the_link_row_gets() {
    // An owned agent's row must NOT say `subagent`: everything downstream —
    // the close cascade, the fanout subselect, the promote refusal — reads
    // the relation and nothing else. `link_new_agent` checks the row it
    // wrote against this, so a spawn that took the wrong writer fails
    // rather than producing a mislabelled agent.
    assert_eq!(
        AgentSessionOwnership::Subagent.relation(),
        SessionLinkRelation::Subagent
    );
    assert_eq!(
        AgentSessionOwnership::OwnedAgent.relation(),
        SessionLinkRelation::OwnedAgent
    );
}

/// The wake half of the spawn, over real stores.
///
/// Both writers this function chooses between are store-backed, so the
/// choice is provable without a runtime: arm through the production
/// `arm_spawn_wake` and read the rows back. `ses_owner` spawns, `ses_peer`
/// is the agent it spawns.
struct WakeFixture {
    subagents: SubagentService,
    wakes: AgentWakeService,
    sessions: SessionStore,
    owner: SessionRecord,
}

fn wake_fixture() -> WakeFixture {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    let fixture = test_support::subagent_service_fixture(&db);
    let owner = session("ses_owner");
    fixture.sessions.insert(&owner).expect("insert owner");
    fixture
        .sessions
        .insert(&session("ses_peer"))
        .expect("insert peer");
    let wakes = AgentWakeService::new(
        fixture.sessions.clone(),
        Arc::new(SessionMutationAdmission::new(Arc::new(NoControllerPolicy))),
    );
    WakeFixture {
        subagents: fixture.service,
        wakes,
        sessions: fixture.sessions,
        owner,
    }
}

fn peer_request(wake_on_completion: bool) -> CreateAgentSessionRequest {
    CreateAgentSessionRequest::owned_agent(
        &session("ses_owner"),
        SpawnAgentArgs {
            wake_on_completion,
            ..spawn_agent_args()
        },
    )
    .expect("build request")
}

#[tokio::test]
async fn the_peers_reply_consumes_the_wake_its_spawn_armed() {
    // The arg description promises exactly this: "its reply already wakes
    // you with the full message; this is the safety net for one that
    // answers nobody". Only a REPLY arm behaves that way — an explicit
    // schedule survives the reply and fires a second, contentless pointer
    // at the same turn's end, so the owner burns a turn on a pointer to a
    // message it already has.
    let fixture = wake_fixture();

    assert!(arm_spawn_wake(
        &fixture.subagents,
        &fixture.wakes,
        &fixture.owner,
        "ses_peer",
        &peer_request(true),
    )
    .expect("arm the spawn wake"));

    let armed = fixture
        .sessions
        .list_agent_wakes_for_target("ses_peer")
        .expect("read the armed row");
    assert_eq!(armed.len(), 1);
    assert_eq!(armed[0].watcher_session_id, "ses_owner");
    assert!(
        armed[0].armed_for_reply,
        "a spawn wake must be consumable by the peer's reply"
    );

    // The peer answers its owner: the schedule comes off...
    assert!(consume_reply_wake(&fixture.wakes, "ses_peer", "ses_owner"));
    // ...so the turn that carried the reply wakes nobody, and no pointer
    // is queued behind the message the owner already received.
    assert!(fixture
        .wakes
        .consume_for_finished_turn("ses_peer", SessionTurnOutcome::Completed)
        .await
        .expect("the peer's first turn finishes")
        .is_empty());
    assert!(fixture
        .sessions
        .list_pending_prompts("ses_owner")
        .expect("owner's pending prompts")
        .is_empty());
}

#[tokio::test]
async fn a_peer_that_answers_nobody_still_wakes_its_owner_at_turn_finish() {
    // The other half of the same contract: the safety net has to actually
    // catch. Nothing replied, so the schedule is still armed when the turn
    // ends and the owner gets its pointer.
    let fixture = wake_fixture();
    arm_spawn_wake(
        &fixture.subagents,
        &fixture.wakes,
        &fixture.owner,
        "ses_peer",
        &peer_request(true),
    )
    .expect("arm the spawn wake");

    let fired = fixture
        .wakes
        .consume_for_finished_turn("ses_peer", SessionTurnOutcome::Completed)
        .await
        .expect("the peer's first turn finishes");

    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].consumed.watcher_session_id, "ses_owner");
}

#[tokio::test]
async fn a_spawn_that_asked_for_no_wake_arms_nothing() {
    // `wakeOnCompletion: false` must leave the table empty — otherwise the
    // owner is woken about an agent it said it did not need to hear from.
    let fixture = wake_fixture();

    assert!(!arm_spawn_wake(
        &fixture.subagents,
        &fixture.wakes,
        &fixture.owner,
        "ses_peer",
        &peer_request(false),
    )
    .expect("no wake asked for"));

    assert!(fixture
        .sessions
        .list_agent_wakes_for_target("ses_peer")
        .expect("read schedules")
        .is_empty());
}

#[test]
fn a_subagent_spawn_takes_the_link_scoped_wake_and_writes_no_session_row() {
    // The other side of the mode split. A subagent's wake hangs off the
    // link completion row, so the session-scoped table must stay empty —
    // if both were written the parent would be woken twice, and if the
    // peer branch leaked into this one the wake would fire off a
    // completion record that never arrives.
    let fixture = wake_fixture();
    fixture
        .sessions
        .insert(&session("ses_child"))
        .expect("insert child");
    fixture
        .subagents
        .link_child("ses_owner", "ses_child", None, None, None)
        .expect("link the subagent");

    let mut request = peer_request(true);
    request.ownership = AgentSessionOwnership::Subagent;

    assert!(arm_spawn_wake(
        &fixture.subagents,
        &fixture.wakes,
        &fixture.owner,
        "ses_child",
        &request,
    )
    .expect("arm the subagent wake"));

    assert!(
        fixture
            .sessions
            .list_agent_wakes_for_target("ses_child")
            .expect("read schedules")
            .is_empty(),
        "a subagent's wake is link-scoped and must not write a session-scoped row"
    );
}

#[test]
fn a_subagents_first_prompt_is_the_authored_text_and_a_peers_is_enveloped() {
    let caller = session("ses_caller");
    let mut request = CreateAgentSessionRequest::subagent(&caller, subagent_args()).expect("build");

    let (text, provenance) = first_prompt(&caller, &link(SessionLinkRelation::Subagent), &request);
    assert_eq!(text, "Audit the schema");
    assert_eq!(
        provenance,
        PromptProvenance::AgentSession {
            source_session_id: "ses_caller".to_string(),
            session_link_id: Some("link-1".to_string()),
            label: Some("API surface check".to_string()),
        }
    );

    request.ownership = AgentSessionOwnership::OwnedAgent;
    let (text, provenance) =
        first_prompt(&caller, &link(SessionLinkRelation::OwnedAgent), &request);
    // The peer is told who is talking and how to answer, and the body is
    // verbatim inside it — the same envelope `send_agent_message` builds.
    assert!(text.starts_with("Message from agent \"Schema audit\" (session ses_caller):"));
    assert!(text.contains("Audit the schema"));
    assert!(text.ends_with("To reply, use send_agent_message with sessionId \"ses_caller\"."));
    assert_eq!(
        provenance,
        PromptProvenance::AgentSession {
            source_session_id: "ses_caller".to_string(),
            // Unlinked, like every other peer message: the ownership row
            // exists, but the message does not claim it.
            session_link_id: None,
            label: Some("Schema audit".to_string()),
        }
    );
}
