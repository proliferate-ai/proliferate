//! The full-lifecycle tier-1 suite: a real `AppState`, real SQLite, a real
//! filesystem workspace, and the house scripted ACP agent — none of our
//! machinery mocked. Every scenario drives the engine the way production
//! does: rows in through the store, the manager's one door for commands, and
//! turn reports arriving through the real session extension when the scripted
//! agent ends its turns.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::app::{test_support, AppState};
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, prompt_texts, read_requests, temp_runtime_home,
    write_scripted_agent, EnvVarGuard, ScriptedAgent,
};
use crate::domains::workflows::definition::{
    DefinitionEdge, DefinitionInput, DefinitionNode, DocTemplate, InvocationPlacement,
    InvocationSnapshot, PlacementMode, WorkflowDefinition, DEFINITION_SCHEMA_VERSION,
};
use crate::domains::workflows::invariants;
use crate::domains::workflows::materialize::materialize_context;
use crate::domains::workflows::model::{
    WorkflowInterruptionCode, WorkflowNodeFailureCode, WorkflowNodeKind, WorkflowNodeStatus,
    WorkflowNodeType, WorkflowRunStatus,
};
use crate::domains::sessions::runtime::SendPromptOutcome;
use crate::domains::workflows::store::{CreatedRun, NewRunParams, WorkflowStore};
use crate::domains::workflows::transition::{
    RunState, TurnFinished, TurnStopReason, WorkflowCommand,
};
use crate::persistence::Db;

const WORKSPACE_ID: &str = "wf-workspace";

pub(super) fn agent_node(id: &str, prompt: &str) -> DefinitionNode {
    DefinitionNode {
        id: id.into(),
        node_type: WorkflowNodeType::Agent,
        title: format!("Node {id}"),
        prompt: prompt.into(),
        model: None,
    }
}

fn hitl_node(id: &str, prompt: &str) -> DefinitionNode {
    DefinitionNode {
        node_type: WorkflowNodeType::HumanInLoop,
        ..agent_node(id, prompt)
    }
}

/// A linear chain: consecutive edges, no inputs, no docs (tests that need
/// them build the definition by hand).
pub(super) fn chain(nodes: Vec<DefinitionNode>) -> WorkflowDefinition {
    let edges = nodes
        .windows(2)
        .map(|pair| DefinitionEdge {
            from: pair[0].id.clone(),
            to: pair[1].id.clone(),
        })
        .collect();
    WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes,
        edges,
        inputs: Vec::new(),
        doc_templates: Vec::new(),
    }
}

pub(super) struct WorkflowFixture {
    pub(super) state: AppState,
    script: ScriptedAgent,
    workspace_root: PathBuf,
    runtime_home: PathBuf,
    _agent_env: (EnvVarGuard, EnvVarGuard),
    _data_key: test_support::DataKeyEnvGuard,
    _bearer: test_support::BearerTokenEnvGuard,
    _env_lock: std::sync::MutexGuard<'static, ()>,
}

impl Drop for WorkflowFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.runtime_home);
    }
}

/// Boot the app over a db that may already hold workflow rows (the boot-fence
/// scenario creates its run BEFORE the app exists — the crash-window shape).
fn boot_fixture(label: &str, prepare: impl FnOnce(&Db, &PathBuf)) -> WorkflowFixture {
    let env_lock = test_support::lock_env();
    let bearer = test_support::set_bearer_token_env(None);
    let data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home(label);
    let script = write_scripted_agent(&runtime_home);
    let agent_env = install_scripted_agent_env(&script);
    let db = Db::open_in_memory().expect("in-memory db");
    let workspace_root = runtime_home.join(WORKSPACE_ID);
    std::fs::create_dir_all(&workspace_root).expect("workspace dir");
    test_support::seed_workspace_with_repo_root(
        &db,
        WORKSPACE_ID,
        "local",
        &workspace_root.to_string_lossy(),
    );
    prepare(&db, &workspace_root);
    let state = build_state(&runtime_home, db, false);
    WorkflowFixture {
        state,
        script,
        workspace_root,
        runtime_home,
        _agent_env: agent_env,
        _data_key: data_key,
        _bearer: bearer,
        _env_lock: env_lock,
    }
}

pub(super) fn fixture(label: &str) -> WorkflowFixture {
    boot_fixture(label, |_, _| {})
}

fn snapshot_for(
    definition: WorkflowDefinition,
    arguments: serde_json::Map<String, serde_json::Value>,
) -> InvocationSnapshot {
    InvocationSnapshot {
        schema_version: DEFINITION_SCHEMA_VERSION,
        workflow_definition_id: "wd-1".into(),
        definition,
        arguments,
        placement: InvocationPlacement {
            repo_config_id: "rc-1".into(),
            mode: PlacementMode::Worktree,
        },
    }
}

fn create_run_rows(
    store: &WorkflowStore,
    workspace_root: &Path,
    run_id: &str,
    snapshot: InvocationSnapshot,
) -> CreatedRun {
    // Production stores the courier's delivered JSON byte-verbatim; the tests
    // build the definition in code, so its serialization stands in for it.
    let definition_json =
        serde_json::to_string(&snapshot.definition).expect("definition json");
    let created = store
        .create_run_with_first_node(NewRunParams {
            run_id: run_id.into(),
            invocation_id: format!("inv-{run_id}"),
            workspace_id: WORKSPACE_ID.into(),
            snapshot: snapshot.clone(),
            definition_json,
        })
        .expect("create run rows");
    materialize_context(workspace_root, run_id, &created.docs, &snapshot.definition.doc_templates)
        .expect("materialize context");
    created
}

impl WorkflowFixture {
    pub(super) fn start(&self, run_id: &str, definition: WorkflowDefinition) -> CreatedRun {
        self.start_with_arguments(run_id, definition, serde_json::Map::new())
    }

    fn start_with_arguments(
        &self,
        run_id: &str,
        definition: WorkflowDefinition,
        arguments: serde_json::Map<String, serde_json::Value>,
    ) -> CreatedRun {
        let created = create_run_rows(
            &self.state.workflow_store,
            &self.workspace_root,
            run_id,
            snapshot_for(definition, arguments),
        );
        self.state
            .workflow_manager
            .start_run(run_id)
            .expect("start run");
        created
    }

    async fn command(&self, run_id: &str, command: WorkflowCommand) {
        self.state
            .workflow_manager
            .command(run_id, command)
            .await
            .expect("workflow command");
    }

    pub(super) async fn wait_for(
        &self,
        run_id: &str,
        what: &str,
        condition: impl Fn(&RunState) -> bool,
    ) -> RunState {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            let state = self
                .state
                .workflow_store
                .load_run_state(run_id)
                .expect("load run state")
                .expect("run exists");
            if condition(&state) {
                return state;
            }
            if tokio::time::Instant::now() > deadline {
                panic!(
                    "timed out waiting for {what}; run={:?} nodes={:?}",
                    state.run.status,
                    state
                        .nodes
                        .iter()
                        .map(|node| (
                            node.definition_node_id.clone(),
                            node.kind,
                            node.status,
                            node.session_id.is_some()
                        ))
                        .collect::<Vec<_>>()
                );
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn wait_for_control(&self, name: &str) {
        let path = self.script.control_dir.join(name);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        while !path.exists() {
            if tokio::time::Instant::now() > deadline {
                panic!("timed out waiting for scripted-agent control file {name}");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    fn touch_control(&self, name: &str) {
        std::fs::write(self.script.control_dir.join(name), "").expect("control file");
    }
}

pub(super) fn node_by_def<'a>(state: &'a RunState, definition_node_id: &str) -> &'a crate::domains::workflows::model::WorkflowRunNodeRecord {
    state
        .nodes
        .iter()
        .find(|node| node.definition_node_id.as_deref() == Some(definition_node_id))
        .unwrap_or_else(|| panic!("node {definition_node_id} missing"))
}

/// Every `session/prompt` request's FULL text-block list, in arrival order —
/// the in-band delivery assertions need the leading instruction blocks, not
/// just the last block `prompt_texts` extracts.
fn prompt_block_texts(path: &std::path::Path) -> Vec<Vec<String>> {
    read_requests(path)
        .into_iter()
        .filter(|request| request["method"] == "session/prompt")
        .filter_map(|request| {
            request["params"]["prompt"].as_array().map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| block["text"].as_str().map(str::to_string))
                    .collect()
            })
        })
        .collect()
}

fn assert_quiesced(state: &RunState) {
    let violations = invariants::sweep(state);
    assert!(violations.is_empty(), "invariant violations: {violations:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn happy_path_resolves_references_teaches_the_preamble_and_completes() {
    let fixture = fixture("wf-happy");
    let definition = WorkflowDefinition {
        schema_version: DEFINITION_SCHEMA_VERSION,
        nodes: vec![
            agent_node("plan", "Plan @input:ticket, write @doc:plan-doc"),
            agent_node("ship", "Ship per @doc:plan-doc"),
        ],
        edges: vec![DefinitionEdge {
            from: "plan".into(),
            to: "ship".into(),
        }],
        inputs: vec![DefinitionInput {
            name: "ticket".into(),
            description: None,
            required: true,
        }],
        doc_templates: vec![DocTemplate {
            slug: "plan-doc".into(),
            producing_node_id: "plan".into(),
            body: "# Plan\n".into(),
        }],
    };
    let mut arguments = serde_json::Map::new();
    arguments.insert("ticket".into(), serde_json::Value::String("PRO-9".into()));
    fixture.start_with_arguments("run-happy", definition, arguments);

    let state = fixture
        .wait_for("run-happy", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    assert_quiesced(&state);

    // Both sessions received the resolved first message, in chain order.
    let doc_path = fixture
        .workspace_root
        .join(".proliferate/context/run-happy/00-plan-doc.md");
    let doc_path = doc_path.to_string_lossy();
    assert_eq!(
        prompt_texts(&fixture.script.request_log),
        vec![
            format!("Plan PRO-9, write {doc_path}"),
            format!("Ship per {doc_path}"),
        ]
    );
    // Ruling D: the wrapped preamble rides IN-BAND as the leading text block
    // of each node's first prompt — identical for every harness — and the
    // node's first message is always the LAST block.
    let payloads = prompt_block_texts(&fixture.script.request_log);
    assert_eq!(payloads.len(), 2, "one first prompt per node session");
    for blocks in &payloads {
        // House machinery may prepend its own leading blocks (product
        // context); the workflow contract is positional, not exhaustive:
        // the preamble is the block immediately before the first message,
        // and it appears exactly once — never doubled, never trailing.
        let preamble = &blocks[blocks.len() - 2];
        assert!(
            preamble.starts_with("System instruction from AnyHarness, not user content:\n"),
            "the exact house sentinel leads the preamble block"
        );
        assert!(preamble.contains("never stop to ask questions"));
        assert!(preamble.contains(&*doc_path));
        assert_eq!(
            blocks
                .iter()
                .filter(|block| block.contains("never stop to ask questions"))
                .count(),
            1,
            "the preamble rides exactly once per first prompt"
        );
    }
    // And never on the session-meta channel: no harness hears it twice, no
    // harness misses it.
    let session_meta_carries_preamble = read_requests(&fixture.script.request_log)
        .into_iter()
        .filter(|request| request["method"] == "session/new")
        .any(|request| {
            request["params"]["_meta"]["systemPrompt"]["append"]
                .as_str()
                .is_some_and(|append| append.contains("never stop to ask questions"))
        });
    assert!(
        !session_meta_carries_preamble,
        "the preamble must not ride systemPrompt.append (Ruling D)"
    );

    // The sessions carry the workflow columns; clearing unlinks (the helper
    // pair the actor and undo-advance rely on).
    let session_store = fixture.state.session_service.store();
    let plan = node_by_def(&state, "plan");
    let plan_session = plan.session_id.clone().expect("plan session");
    assert_eq!(
        session_store
            .workflow_columns(&plan_session)
            .expect("columns"),
        Some(("run-happy".to_string(), plan.id.clone()))
    );
    session_store
        .clear_workflow_columns(&plan_session)
        .expect("clear");
    assert_eq!(
        session_store
            .workflow_columns(&plan_session)
            .expect("columns after clear"),
        None
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_gate_parks_the_run_and_approve_advances_it() {
    let fixture = fixture("wf-gate");
    let definition = chain(vec![
        hitl_node("review", "Summarize for review"),
        agent_node("ship", "Ship it"),
    ]);
    fixture.start("run-gate", definition);

    let state = fixture
        .wait_for("run-gate", "gate parks", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let review = node_by_def(&state, "review");
    assert_eq!(review.status, WorkflowNodeStatus::AwaitingHuman);

    fixture
        .command(
            "run-gate",
            WorkflowCommand::ApproveGate {
                node_row_id: review.id.clone(),
            },
        )
        .await;
    let state = fixture
        .wait_for("run-gate", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    assert_eq!(
        node_by_def(&state, "review").status,
        WorkflowNodeStatus::Completed
    );
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn flip_type_advances_a_waiting_gate_and_parks_a_running_agent_node() {
    let fixture = fixture("wf-flip");
    let definition = chain(vec![
        hitl_node("gate", "Check the plan"),
        agent_node("work", "blocking turn"),
    ]);
    fixture.start("run-flip", definition);

    // Waiting gate flipped to agent: the finished turn counts as done.
    let state = fixture
        .wait_for("run-flip", "gate parks", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let gate = node_by_def(&state, "gate");
    fixture
        .command(
            "run-flip",
            WorkflowCommand::FlipType {
                node_row_id: gate.id.clone(),
                node_type: WorkflowNodeType::Agent,
            },
        )
        .await;

    // The advance launched the held node; flip it while its turn runs.
    fixture.wait_for_control("turn-seen").await;
    let state = fixture
        .wait_for("run-flip", "work node running", |state| {
            node_by_def(state, "work").status == WorkflowNodeStatus::Running
        })
        .await;
    let work = node_by_def(&state, "work");
    fixture
        .command(
            "run-flip",
            WorkflowCommand::FlipType {
                node_row_id: work.id.clone(),
                node_type: WorkflowNodeType::HumanInLoop,
            },
        )
        .await;

    // Its clean turn end now lands on the human_in_loop row of the table.
    fixture.touch_control("release-turn");
    let state = fixture
        .wait_for("run-flip", "flipped node parks", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
                && node_by_def(state, "work").status == WorkflowNodeStatus::AwaitingHuman
        })
        .await;
    let work = node_by_def(&state, "work");
    fixture
        .command(
            "run-flip",
            WorkflowCommand::ApproveGate {
                node_row_id: work.id.clone(),
            },
        )
        .await;
    let state = fixture
        .wait_for("run-flip", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refusal_fails_the_run_and_fail_and_redo_replaces_the_node() {
    let fixture = fixture("wf-redo");
    let definition = chain(vec![agent_node("solo", "PLEASE-REFUSE to do this")]);
    fixture.start("run-redo", definition);

    let state = fixture
        .wait_for("run-redo", "refusal fails the run", |state| {
            state.run.status == WorkflowRunStatus::Failed
        })
        .await;
    let failed = node_by_def(&state, "solo");
    assert_eq!(failed.status, WorkflowNodeStatus::Failed);
    assert_eq!(failed.failure_code, Some(WorkflowNodeFailureCode::Refusal));

    fixture
        .command(
            "run-redo",
            WorkflowCommand::FailAndRedo {
                node_row_id: failed.id.clone(),
                prompt: Some("Redo this cleanly".into()),
            },
        )
        .await;
    let state = fixture
        .wait_for("run-redo", "replacement completes the run", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    let failed_id = failed.id.clone();
    let replacement = state
        .nodes
        .iter()
        .find(|node| node.replaces_node_row_id.as_deref() == Some(failed_id.as_str()))
        .expect("replacement row");
    assert_eq!(replacement.kind, WorkflowNodeKind::Replacement);
    assert_eq!(replacement.status, WorkflowNodeStatus::Completed);
    // The failed row stays beside its replacement, untouched.
    assert_eq!(
        node_by_def(&state, "solo").status,
        WorkflowNodeStatus::Failed
    );
    assert!(prompt_texts(&fixture.script.request_log)
        .contains(&"Redo this cleanly".to_string()));
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn undo_advance_disposes_the_young_session_and_reapproving_relaunches() {
    let fixture = fixture("wf-undo");
    let definition = chain(vec![
        agent_node("first", "do the first step"),
        agent_node("second", "blocking turn"),
    ]);
    fixture.start("run-undo", definition);

    // The advance started the held node: a linked, running session exists.
    fixture.wait_for_control("turn-seen").await;
    let state = fixture
        .wait_for("run-undo", "second node running with a session", |state| {
            let second = node_by_def(state, "second");
            second.status == WorkflowNodeStatus::Running && second.session_id.is_some()
        })
        .await;
    let young_session = node_by_def(&state, "second")
        .session_id
        .clone()
        .expect("young session");

    fixture
        .command("run-undo", WorkflowCommand::UndoAdvance)
        .await;
    let state = fixture
        .wait_for("run-undo", "undo parks the predecessor", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let first = node_by_def(&state, "first");
    let second = node_by_def(&state, "second");
    assert_eq!(first.status, WorkflowNodeStatus::AwaitingHuman);
    assert_eq!(second.status, WorkflowNodeStatus::Pending);
    assert_eq!(second.session_id, None, "the undone row is unlinked");
    // The disposed session no longer reports into any workflow.
    assert_eq!(
        fixture
            .state
            .session_service
            .store()
            .workflow_columns(&young_session)
            .expect("columns"),
        None
    );

    // Re-approving relaunches the same row in a fresh session.
    fixture.touch_control("release-turn");
    fixture
        .command(
            "run-undo",
            WorkflowCommand::ApproveGate {
                node_row_id: first.id.clone(),
            },
        )
        .await;
    let state = fixture
        .wait_for("run-undo", "run completed after relaunch", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    let second = node_by_def(&state, "second");
    assert_eq!(second.status, WorkflowNodeStatus::Completed);
    assert_ne!(
        second.session_id.as_deref(),
        Some(young_session.as_str()),
        "the relaunch minted a fresh session"
    );
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_adhoc_node_runs_beside_the_chain_and_never_moves_it() {
    let fixture = fixture("wf-adhoc");
    let definition = chain(vec![agent_node("solo", "blocking turn")]);
    let created = fixture.start("run-adhoc", definition);

    fixture.wait_for_control("turn-seen").await;
    fixture
        .command(
            "run-adhoc",
            WorkflowCommand::AddAdhocNode {
                anchor_node_row_id: created.first_node_row_id.clone(),
                prompt: "adhoc side question".into(),
                // The launch pick must reach the minted session (F3): same
                // scripted agent kind, but a distinctive model id to trace.
                model: Some(crate::domains::workflows::definition::NodeModel {
                    agent_kind: "claude".into(),
                    model_id: Some("haiku".into()),
                    control_values: Default::default(),
                }),
            },
        )
        .await;

    // The adhoc node completes its own row while the chain node still runs.
    let state = fixture
        .wait_for("run-adhoc", "adhoc row completed", |state| {
            state
                .nodes
                .iter()
                .any(|node| {
                    node.kind == WorkflowNodeKind::Adhoc
                        && node.status == WorkflowNodeStatus::Completed
                })
        })
        .await;
    assert_eq!(state.run.status, WorkflowRunStatus::Running);
    assert_eq!(
        node_by_def(&state, "solo").status,
        WorkflowNodeStatus::Running
    );
    let adhoc = state
        .nodes
        .iter()
        .find(|node| node.kind == WorkflowNodeKind::Adhoc)
        .expect("adhoc row");
    assert_eq!(
        adhoc.anchor_node_row_id.as_deref(),
        Some(created.first_node_row_id.as_str())
    );
    assert!(prompt_texts(&fixture.script.request_log)
        .contains(&"adhoc side question".to_string()));
    // The pick persisted on the row and reached the minted session (F3): a
    // model choice the API accepted must never silently launch the default.
    assert_eq!(
        adhoc.model.as_ref().and_then(|model| model.model_id.as_deref()),
        Some("haiku")
    );
    // Creation records the validated pick on the immutable launch intent.
    let store = fixture.state.session_service.store();
    let adhoc_intent = store
        .find_launch_intent(adhoc.session_id.as_deref().expect("adhoc session"))
        .expect("load adhoc launch intent")
        .expect("adhoc session owns a launch intent");
    assert_eq!(adhoc_intent.model_id.as_deref(), Some("haiku"));

    fixture.touch_control("release-turn");
    let state = fixture
        .wait_for("run-adhoc", "chain completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_boot_fence_heals_the_crash_window_and_resume_completes_the_run() {
    // The crash-window shape: run and node rows committed, the session never
    // born. The rows exist BEFORE the app boots, exactly like a restart.
    let fixture = boot_fixture("wf-fence", |db, workspace_root| {
        create_run_rows(
            &WorkflowStore::new(db.clone()),
            workspace_root,
            "run-fence",
            snapshot_for(chain(vec![agent_node("solo", "heal me")]), serde_json::Map::new()),
        );
    });

    // AppState::new ran the fence before the manager accepted anything.
    let state = fixture
        .state
        .workflow_store
        .load_run_state("run-fence")
        .expect("load")
        .expect("run exists");
    assert_eq!(state.run.status, WorkflowRunStatus::Interrupted);
    assert_eq!(
        state.run.interruption_code,
        Some(WorkflowInterruptionCode::RuntimeRestarted)
    );
    assert_eq!(
        node_by_def(&state, "solo").status,
        WorkflowNodeStatus::NeedsAttention
    );

    // Resume is always a human choice; it mints the session that never got
    // born, in the same workspace.
    fixture
        .command("run-fence", WorkflowCommand::Resume)
        .await;
    let state = fixture
        .wait_for("run-fence", "resumed run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    assert!(node_by_def(&state, "solo").session_id.is_some());
    assert_eq!(prompt_texts(&fixture.script.request_log), vec!["heal me"]);
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_queued_interjection_holds_the_advance_until_the_queue_drains() {
    let fixture = fixture("wf-interject");
    let definition = chain(vec![
        agent_node("hold", "blocking turn"),
        agent_node("ship", "then ship"),
    ]);
    fixture.start("run-interject", definition);

    fixture.wait_for_control("turn-seen").await;
    let state = fixture
        .wait_for("run-interject", "hold node has a session", |state| {
            node_by_def(state, "hold").session_id.is_some()
        })
        .await;
    let session_id = node_by_def(&state, "hold")
        .session_id
        .clone()
        .expect("hold session");

    // A user interjection lands mid-turn: gen-2 sessions stay chattable, so
    // the session actor queues it — and its presence must HOLD the chain when
    // the blocking turn ends, or the queued message would be abandoned in a
    // session the run has already moved past.
    let outcome = fixture
        .state
        .session_runtime
        .send_text_prompt_with_id(
            &session_id,
            "queued interjection".into(),
            "test-interjection-1".into(),
        )
        .await
        .expect("interjection accepted");
    assert!(
        matches!(outcome, SendPromptOutcome::Queued { .. }),
        "the interjection queues behind the live turn"
    );

    fixture.touch_control("release-turn");
    let state = fixture
        .wait_for("run-interject", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    // The queued message ran inside the hold node's session BEFORE the chain
    // advanced: the whole run's prompt order, exact — nothing dropped, nothing
    // reordered.
    assert_eq!(
        prompt_texts(&fixture.script.request_log),
        vec!["blocking turn", "queued interjection", "then ship"]
    );
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_turn_report_after_undo_neither_moves_rows_nor_closes_the_window() {
    let fixture = fixture("wf-stale");
    let definition = chain(vec![
        agent_node("first", "do the first step"),
        agent_node("second", "blocking turn"),
    ]);
    fixture.start("run-stale", definition);

    fixture.wait_for_control("turn-seen").await;
    fixture
        .wait_for("run-stale", "second node running with a session", |state| {
            let second = node_by_def(state, "second");
            second.status == WorkflowNodeStatus::Running && second.session_id.is_some()
        })
        .await;
    fixture
        .command("run-stale", WorkflowCommand::UndoAdvance)
        .await;
    let state = fixture
        .wait_for("run-stale", "undo parks the predecessor", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let second = node_by_def(&state, "second");
    assert_eq!(second.session_id, None);
    assert!(second.first_turn_finished_at.is_none(), "window open");

    // The disposed session's dying report was already in flight when undo
    // landed: replay that straggler by hand. The unlinked row makes it stale,
    // so it must move no rows AND must not stamp shut the undo window the
    // undo just reopened (Ruling J's ordering: staleness before the stamp).
    fixture.state.workflow_manager.notify(
        "run-stale",
        TurnFinished {
            node_row_id: second.id.clone(),
            stop_reason: TurnStopReason::CleanEndTurn,
            queue_empty: true,
        },
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    let state = fixture
        .state
        .workflow_store
        .load_run_state("run-stale")
        .expect("load run state")
        .expect("run exists");
    assert_eq!(state.run.status, WorkflowRunStatus::AwaitingHuman);
    let second = node_by_def(&state, "second");
    assert_eq!(second.status, WorkflowNodeStatus::Pending);
    assert!(
        second.first_turn_finished_at.is_none(),
        "a stale report must not close the undo window (Ruling J)"
    );

    // And the run is still healthy: re-approving relaunches and completes.
    fixture.touch_control("release-turn");
    let first = node_by_def(&state, "first");
    fixture
        .command(
            "run-stale",
            WorkflowCommand::ApproveGate {
                node_row_id: first.id.clone(),
            },
        )
        .await;
    let state = fixture
        .wait_for("run-stale", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_launch_fails_the_run_and_compensates_the_half_born_session() {
    use crate::integrations::agent_cli::executable::make_executable;

    let fixture = fixture("wf-launchfail");
    // Swap the agent for a dud AFTER the fixture installed the real one: a
    // valid executable (so readiness passes and the durable session row gets
    // created) that exits without ever speaking ACP (so the start fails —
    // the failure lands AFTER the row exists, the compensation window). The
    // fixture holds the env lock for its whole life, so the direct set_var
    // is race-free, and the fixture's own guard restores the value on drop.
    let dud = fixture.runtime_home.join("dud-agent");
    std::fs::write(&dud, "#!/bin/sh\nexit 0\n").expect("write dud agent");
    make_executable(&dud).expect("make dud agent executable");
    std::env::set_var("ANYHARNESS_CLAUDE_AGENT_PROGRAM", &dud);
    // The swap moves the harness basis, so re-observe: admission must pass on
    // target-observed options and the launch must fail at spawn instead.
    test_support::seed_scripted_claude_launch_options(&fixture.state.launch_options_service);
    let definition = chain(vec![agent_node("solo", "never launches")]);
    fixture.start("run-launchfail", definition);

    let state = fixture
        .wait_for("run-launchfail", "launch failure fails the run", |state| {
            state.run.status == WorkflowRunStatus::Failed
        })
        .await;
    assert_eq!(
        state.run.failure_code.as_deref(),
        Some("node_launch_failed")
    );
    let solo = node_by_def(&state, "solo");
    assert_eq!(solo.status, WorkflowNodeStatus::Failed);
    assert_eq!(
        solo.failure_code,
        Some(WorkflowNodeFailureCode::NodeLaunchFailed)
    );

    // The house compensation ran: the stamped session row is GONE — a
    // half-born session must not linger in the run workspace.
    let stamped = solo
        .session_id
        .clone()
        .expect("the launch stamped the session before starting it");
    assert!(
        fixture
            .state
            .session_service
            .get_session(&stamped)
            .expect("session lookup")
            .is_none(),
        "compensation deletes the half-born session row"
    );
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn turn_reports_never_block_even_while_the_actor_is_busy() {
    let fixture = fixture("wf-wedge");
    let definition = chain(vec![agent_node("solo", "blocking turn")]);
    let created = fixture.start("run-wedge", definition);

    fixture.wait_for_control("turn-seen").await;
    // Keep the actor busy: an adhoc launch is a real multi-step side effect
    // (render, create, start, dispatch) performed inline on its loop.
    let manager = fixture.state.workflow_manager.clone();
    let anchor = created.first_node_row_id.clone();
    let adhoc_command = tokio::spawn(async move {
        manager
            .command(
                "run-wedge",
                WorkflowCommand::AddAdhocNode {
                    anchor_node_row_id: anchor,
                    prompt: "wedge probe".into(),
                    model: None,
                },
            )
            .await
    });

    // The session actor's finish path calls notify() synchronously, so it
    // must never wait on the workflow actor, whatever that actor is doing.
    // Scope honesty: this pins the fire-and-forget unbounded send and the
    // brief registry lock — a bounded wall clock for a thousand sends while
    // the actor works its mailbox.
    let spam_started = std::time::Instant::now();
    for i in 0..1000 {
        fixture.state.workflow_manager.notify(
            "run-wedge",
            TurnFinished {
                node_row_id: format!("junk-{i}"),
                stop_reason: TurnStopReason::CleanEndTurn,
                queue_empty: true,
            },
        );
    }
    assert!(
        spam_started.elapsed() < Duration::from_secs(5),
        "notify must not block on a busy actor"
    );
    adhoc_command
        .await
        .expect("adhoc task")
        .expect("adhoc command");
    fixture
        .wait_for("run-wedge", "adhoc probe completed", |state| {
            state.nodes.iter().any(|node| {
                node.kind == WorkflowNodeKind::Adhoc
                    && node.status == WorkflowNodeStatus::Completed
            })
        })
        .await;

    fixture.touch_control("release-turn");
    let state = fixture
        .wait_for("run-wedge", "run completed", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    // Every junk report was dropped as stale: rows moved only for the real
    // chain node and the adhoc probe.
    assert_eq!(state.nodes.len(), 2);
    assert!(state
        .nodes
        .iter()
        .all(|node| node.status == WorkflowNodeStatus::Completed));
    assert_quiesced(&state);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fail_and_redo_from_running_disposes_the_wedged_session_and_relaunches() {
    let fixture = fixture("wf-redorun");
    let definition = chain(vec![agent_node("solo", "blocking turn")]);
    fixture.start("run-redorun", definition);

    fixture.wait_for_control("turn-seen").await;
    let state = fixture
        .wait_for("run-redorun", "node running with a session", |state| {
            node_by_def(state, "solo").session_id.is_some()
        })
        .await;
    let solo = node_by_def(&state, "solo");
    let old_id = solo.id.clone();
    let wedged_session = solo.session_id.clone().expect("wedged session");

    // Ruling L: a wedged RUNNING chain node is redoable — the redo takes
    // over, disposes the live session mid-turn, and relaunches replacement.
    fixture
        .command(
            "run-redorun",
            WorkflowCommand::FailAndRedo {
                node_row_id: old_id.clone(),
                prompt: Some("redo from running".into()),
            },
        )
        .await;

    let state = fixture
        .wait_for("run-redorun", "replacement completes the run", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    let old = state
        .nodes
        .iter()
        .find(|node| node.id == old_id)
        .expect("old row");
    assert_eq!(old.status, WorkflowNodeStatus::Failed);
    // Taken over from a running (non-failed) state: superseded, not a
    // turn-sourced failure code.
    assert_eq!(
        old.failure_code,
        Some(WorkflowNodeFailureCode::Superseded)
    );
    // Disposed, not destroyed: the session row survives, but it no longer
    // reports into any workflow.
    assert!(
        fixture
            .state
            .session_service
            .get_session(&wedged_session)
            .expect("session lookup")
            .is_some(),
        "disposal dismisses, it never deletes"
    );
    assert_eq!(
        fixture
            .state
            .session_service
            .store()
            .workflow_columns(&wedged_session)
            .expect("columns"),
        None
    );
    let replacement = state
        .nodes
        .iter()
        .find(|node| node.replaces_node_row_id.as_deref() == Some(old_id.as_str()))
        .expect("replacement row");
    assert_eq!(replacement.kind, WorkflowNodeKind::Replacement);
    assert_eq!(replacement.status, WorkflowNodeStatus::Completed);
    assert!(prompt_texts(&fixture.script.request_log)
        .contains(&"redo from running".to_string()));
    assert_quiesced(&state);
}
