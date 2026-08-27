//! Every transaction that touches the three gen-2 workflow tables. The store
//! owns id minting and timestamps so the transition function stays pure:
//! `create_run_with_first_node` and `apply_transition` each commit exactly one
//! SQLite transaction, and only after that commit does the caller perform the
//! side effect the returned `ResolvedSideEffect` names (persist-before-act).
//! Reads for the API come from these rows, never from live actors.

use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};
use uuid::Uuid;

use super::definition::InvocationSnapshot;
use super::model::{
    RenderedEnvelope, WorkflowNodeFailureCode, WorkflowNodeKind, WorkflowNodeStatus,
    WorkflowNodeType, WorkflowRunDocRecord, WorkflowRunNodeRecord, WorkflowRunRecord,
    WorkflowRunStatus,
};
use super::projection::{project, RunProjection};
use super::transition::{
    AdhocOutcome, Decision, NewNodeSpec, RunState, Transition, TurnStopReason, WorkflowEvent,
};
use crate::observability::{
    WORKFLOW_BOOT_FENCE_TRACING_TARGET, WORKFLOW_INTERJECTION_HELD_TRACING_TARGET,
    WORKFLOW_NODE_LAUNCHED_TRACING_TARGET, WORKFLOW_NODE_LAUNCH_FAILED_TRACING_TARGET,
    WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET, WORKFLOW_RUN_FINISHED_TRACING_TARGET,
    WORKFLOW_RUN_STARTED_TRACING_TARGET, WORKFLOW_TRANSITION_ILLEGAL_TRACING_TARGET,
    WORKFLOW_TRANSITION_TRACING_TARGET,
};
use crate::persistence::Db;

#[derive(Clone)]
pub struct WorkflowStore {
    db: Db,
}

/// Inputs to `create_run_with_first_node`. The courier mints `run_id`; PUT is
/// idempotent on it. The snapshot arrives already revalidated by the API layer
/// but the store revalidates anyway — it needs the chain order and refuses to
/// persist an invalid definition under any caller.
#[derive(Debug, Clone)]
pub struct NewRunParams {
    pub run_id: String,
    pub invocation_id: String,
    pub workspace_id: String,
    pub snapshot: InvocationSnapshot,
    /// The delivered `definition` JSON as the API layer re-emitted it from
    /// the request body's parsed `Value` (serde_json's map ordering makes it
    /// key-sorted, not byte-verbatim; `deny_unknown_fields` on the definition
    /// means no information is lost). The store never re-serializes the
    /// parsed struct into it.
    pub definition_json: String,
}

#[derive(Debug, Clone)]
pub struct CreatedRun {
    pub state: RunState,
    pub docs: Vec<WorkflowRunDocRecord>,
    pub first_node_row_id: String,
    /// False when the run id already existed: the idempotent PUT replay. The
    /// existing rows come back untouched and no side effect is due.
    pub created: bool,
}

/// The action the live engine owes after a committed transition. Ids are
/// resolved: replacement/adhoc rows minted in the transaction appear here by
/// their real row id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSideEffect {
    None,
    StartNode {
        node_row_id: String,
    },
    DisposeSession {
        session_id: String,
    },
    /// Ruling L's compound effect: a redo of a RUNNING node first disposes
    /// the session it took over from, then starts the minted replacement.
    DisposeThenStart {
        session_id: String,
        node_row_id: String,
    },
    /// Cancel's compound effect: every running row's live session (chain node
    /// plus any concurrently running adhoc rows) is disposed; nothing starts
    /// after, since the run is terminal.
    DisposeSessions {
        session_ids: Vec<String>,
    },
}

#[derive(Debug, Clone)]
pub struct AppliedTransition {
    pub state: RunState,
    pub side_effect: ResolvedSideEffect,
    /// The row minted by a `Redo` or `AddAdhoc` transition, when one was.
    pub created_node_row_id: Option<String>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// The one-live-run law refused an insert (Ruling B, journaled as an ADR
/// amendment): the placement workspace already hosts a non-terminal run. The
/// API layer downcasts to answer 409 `WORKFLOW_PLACEMENT_CONFLICT`.
#[derive(Debug)]
pub struct WorkspaceOccupied {
    pub workspace_id: String,
    pub occupant_run_id: String,
}

impl std::fmt::Display for WorkspaceOccupied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "workspace {} already hosts non-terminal workflow run {}",
            self.workspace_id, self.occupant_run_id
        )
    }
}

impl std::error::Error for WorkspaceOccupied {}

/// What `node_membership` found — the command routes' 404 discriminator
/// (unknown run and unknown node carry different codes), answered from one
/// cheap read instead of the full projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeMembership {
    RunMissing,
    NodeMissing,
    Present,
}

fn mint_id() -> String {
    Uuid::new_v4().to_string()
}

impl WorkflowStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// One transaction: the run row (running), every chain node row (first
    /// running, rest pending), and the doc registry rows seeded from the
    /// definition's templates. Replaying an existing run id returns the stored
    /// rows untouched. Emits `workflow.run.started` after the commit.
    pub fn create_run_with_first_node(&self, params: NewRunParams) -> anyhow::Result<CreatedRun> {
        let chain = params
            .snapshot
            .validate()
            .map_err(|error| anyhow::anyhow!("invalid invocation snapshot: {error}"))?;

        let created = self.db.with_tx_anyhow(|tx| {
            if let Some(existing) = Self::load_run_state_tx(tx, &params.run_id)? {
                let docs = Self::list_docs_tx(tx, &params.run_id)?;
                let first_node_row_id = existing
                    .effective_chain()
                    .first()
                    .map(|node| node.id.clone())
                    .unwrap_or_default();
                return Ok(CreatedRun {
                    state: existing,
                    docs,
                    first_node_row_id,
                    created: false,
                });
            }

            // The one-live-run law (Ruling B), enforced inside the insert
            // transaction so racing PUTs of different run ids into one
            // workspace cannot both pass a route-level pre-check.
            if let Some(occupant_run_id) =
                Self::non_terminal_run_for_workspace_tx(tx, &params.workspace_id)?
            {
                return Err(anyhow::Error::new(WorkspaceOccupied {
                    workspace_id: params.workspace_id.clone(),
                    occupant_run_id,
                }));
            }

            let timestamp = now();
            let definition = &params.snapshot.definition;
            let arguments_json = serde_json::to_string(&params.snapshot.arguments)?;
            let definition_json = params.definition_json.as_str();

            // Mint every chain row id up front: the run row references the
            // first, doc rows reference their producers.
            let row_ids: Vec<String> = chain.iter().map(|_| mint_id()).collect();
            let first_node_row_id = row_ids[0].clone();

            tx.execute(
                "INSERT INTO workflow_runs (
                    id, invocation_id, definition_json, arguments_json, workspace_id,
                    status, current_node_row_id, failure_code, interruption_code,
                    created_at, updated_at, completed_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, NULL, NULL, ?7, ?7, NULL)",
                params![
                    params.run_id,
                    params.invocation_id,
                    definition_json,
                    arguments_json,
                    params.workspace_id,
                    first_node_row_id,
                    timestamp,
                ],
            )?;

            for (position, definition_node_id) in chain.iter().enumerate() {
                let node = definition
                    .nodes
                    .iter()
                    .find(|node| &node.id == definition_node_id)
                    .expect("validate() returned a chain of declared node ids");
                let first = position == 0;
                tx.execute(
                    "INSERT INTO workflow_run_nodes (
                        id, run_id, definition_node_id, kind, node_type,
                        replaces_node_row_id, anchor_node_row_id, chain_index,
                        title, prompt, status, session_id, prompt_id, model,
                        rendered_envelope, failure_code, created_at, started_at, completed_at
                     )
                     VALUES (?1, ?2, ?3, 'defined', ?4, NULL, NULL, ?5, ?6, ?7, ?8,
                             NULL, NULL, NULL, NULL, NULL, ?9, ?10, NULL)",
                    params![
                        row_ids[position],
                        params.run_id,
                        definition_node_id,
                        node.node_type.as_str(),
                        position as i64,
                        node.title,
                        node.prompt,
                        if first { "running" } else { "pending" },
                        timestamp,
                        if first {
                            Some(timestamp.as_str())
                        } else {
                            None
                        },
                    ],
                )?;
            }

            for template in &definition.doc_templates {
                let producing_position = chain
                    .iter()
                    .position(|definition_node_id| {
                        definition_node_id == &template.producing_node_id
                    })
                    .expect("validate() checked every producing node id is on the chain");
                let filename = doc_filename(&template.slug, producing_position as i64);
                tx.execute(
                    "INSERT INTO workflow_run_docs (
                        id, run_id, slug, filename, producing_node_row_id,
                        seeded_from_template, created_at, updated_at
                     )
                     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
                    params![
                        mint_id(),
                        params.run_id,
                        template.slug,
                        filename,
                        row_ids[producing_position].as_str(),
                        timestamp,
                    ],
                )?;
            }

            let state = Self::load_run_state_tx(tx, &params.run_id)?
                .expect("the run row was inserted in this transaction");
            let docs = Self::list_docs_tx(tx, &params.run_id)?;
            Ok(CreatedRun {
                state,
                docs,
                first_node_row_id,
                created: true,
            })
        })?;

        if created.created {
            tracing::info!(
                target: WORKFLOW_RUN_STARTED_TRACING_TARGET,
                run_id = %created.state.run.id,
                invocation_id = %created.state.run.invocation_id,
                definition_id = %params.snapshot.workflow_definition_id,
                workspace_id = %created.state.run.workspace_id,
                node_count = created.state.nodes.len(),
                "workflow run started",
            );
        }
        Ok(created)
    }

    /// Apply one `Transition` from the pure function in one transaction, then
    /// emit the transition's named events (`event` is the cause that produced
    /// the decision, so table rows sharing a transition shape stay
    /// distinguishable in telemetry). The caller performs the returned side
    /// effect only after this returns. Debug builds sweep the invariants on
    /// the committed state and panic on any violation.
    pub fn apply_transition(
        &self,
        run_id: &str,
        transition: &Transition,
        event: &WorkflowEvent,
    ) -> anyhow::Result<AppliedTransition> {
        let (applied, from_state) = self.db.with_tx_anyhow(|tx| {
            let state = Self::load_run_state_tx(tx, run_id)?
                .ok_or_else(|| anyhow::anyhow!("workflow run {run_id} not found"))?;
            let from_state = state.run.status;
            let timestamp = now();
            let mut side_effect = ResolvedSideEffect::None;
            let mut created_node_row_id = None;

            match transition {
                Transition::AdvanceToNext {
                    completed_node_row_id,
                    next_node_row_id,
                    completed_node_type,
                } => {
                    complete_node(tx, completed_node_row_id, &timestamp, *completed_node_type)?;
                    start_node_row(tx, next_node_row_id, &timestamp)?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::Running),
                            current_node_row_id: Some(Some(next_node_row_id.clone())),
                            ..RunUpdate::default()
                        },
                    )?;
                    side_effect = ResolvedSideEffect::StartNode {
                        node_row_id: next_node_row_id.clone(),
                    };
                }
                Transition::CompleteRun {
                    completed_node_row_id,
                    completed_node_type,
                } => {
                    complete_node(tx, completed_node_row_id, &timestamp, *completed_node_type)?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::Completed),
                            completed_at: Some(Some(timestamp.clone())),
                            ..RunUpdate::default()
                        },
                    )?;
                }
                Transition::GateNode { node_row_id } => {
                    set_node_status(tx, node_row_id, WorkflowNodeStatus::AwaitingHuman)?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::AwaitingHuman),
                            ..RunUpdate::default()
                        },
                    )?;
                }
                Transition::FailNode { node_row_id, code } => {
                    fail_node(tx, node_row_id, *code)?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::Failed),
                            failure_code: Some(Some(code.as_str().to_string())),
                            completed_at: Some(Some(timestamp.clone())),
                            ..RunUpdate::default()
                        },
                    )?;
                }
                Transition::InterruptNode { node_row_id, code } => {
                    set_node_status(tx, node_row_id, WorkflowNodeStatus::NeedsAttention)?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::Interrupted),
                            interruption_code: Some(Some(code.as_str().to_string())),
                            ..RunUpdate::default()
                        },
                    )?;
                }
                Transition::FlipNodeType {
                    node_row_id,
                    node_type,
                } => {
                    tx.execute(
                        "UPDATE workflow_run_nodes SET node_type = ?2 WHERE id = ?1",
                        params![node_row_id, node_type.as_str()],
                    )?;
                    update_run(tx, run_id, &timestamp, RunUpdate::default())?;
                }
                Transition::Redo {
                    failed_node_row_id,
                    replacement,
                    disposed_session_id,
                } => {
                    supersede_node(tx, failed_node_row_id)?;
                    let new_id = insert_new_node(tx, run_id, replacement, &timestamp)?;
                    if replacement.kind == WorkflowNodeKind::Adhoc {
                        // An adhoc redo touches only its own rows: the run's
                        // status, current node, and codes stay untouched.
                        update_run(tx, run_id, &timestamp, RunUpdate::default())?;
                    } else {
                        update_run(
                            tx,
                            run_id,
                            &timestamp,
                            RunUpdate {
                                status: Some(WorkflowRunStatus::Running),
                                current_node_row_id: Some(Some(new_id.clone())),
                                failure_code: Some(None),
                                interruption_code: Some(None),
                                completed_at: Some(None),
                            },
                        )?;
                    }
                    side_effect = match disposed_session_id {
                        // Ruling L: a redo-from-running kills the wedged
                        // session before the replacement launches.
                        Some(session_id) => ResolvedSideEffect::DisposeThenStart {
                            session_id: session_id.clone(),
                            node_row_id: new_id.clone(),
                        },
                        None => ResolvedSideEffect::StartNode {
                            node_row_id: new_id.clone(),
                        },
                    };
                    created_node_row_id = Some(new_id);
                }
                Transition::UndoAdvance {
                    undone_node_row_id,
                    gate_node_row_id,
                    disposed_session_id,
                } => {
                    // The undone node returns to pending unlinked: its
                    // just-created session is disposed after commit.
                    tx.execute(
                        "UPDATE workflow_run_nodes
                         SET status = 'pending', session_id = NULL, prompt_id = NULL,
                             started_at = NULL, first_turn_finished_at = NULL
                         WHERE id = ?1",
                        params![undone_node_row_id],
                    )?;
                    // The completed node parks as a retroactive gate.
                    tx.execute(
                        "UPDATE workflow_run_nodes
                         SET status = 'awaiting_human', completed_at = NULL
                         WHERE id = ?1",
                        params![gate_node_row_id],
                    )?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::AwaitingHuman),
                            current_node_row_id: Some(Some(gate_node_row_id.clone())),
                            ..RunUpdate::default()
                        },
                    )?;
                    if let Some(session_id) = disposed_session_id {
                        side_effect = ResolvedSideEffect::DisposeSession {
                            session_id: session_id.clone(),
                        };
                    }
                }
                Transition::Fence {
                    node_row_ids,
                    interrupt_run,
                    code,
                } => {
                    for node_row_id in node_row_ids {
                        set_node_status(tx, node_row_id, WorkflowNodeStatus::NeedsAttention)?;
                    }
                    if *interrupt_run {
                        update_run(
                            tx,
                            run_id,
                            &timestamp,
                            RunUpdate {
                                status: Some(WorkflowRunStatus::Interrupted),
                                interruption_code: Some(Some(code.as_str().to_string())),
                                ..RunUpdate::default()
                            },
                        )?;
                    } else {
                        // The run keeps its status: a parked gate (or a
                        // terminal run with an orphaned adhoc) survives the
                        // fence untouched beyond its node rows.
                        update_run(tx, run_id, &timestamp, RunUpdate::default())?;
                    }
                }
                Transition::ResumeNode { node_row_id } => {
                    // A fresh session re-runs the node: the old link clears
                    // now, the new session stamps after launch.
                    tx.execute(
                        "UPDATE workflow_run_nodes
                         SET status = 'running', session_id = NULL, prompt_id = NULL,
                             failure_code = NULL, started_at = ?2,
                             first_turn_finished_at = NULL
                         WHERE id = ?1",
                        params![node_row_id, timestamp],
                    )?;
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::Running),
                            interruption_code: Some(None),
                            ..RunUpdate::default()
                        },
                    )?;
                    side_effect = ResolvedSideEffect::StartNode {
                        node_row_id: node_row_id.clone(),
                    };
                }
                Transition::AddAdhoc { adhoc } => {
                    let new_id = insert_new_node(tx, run_id, adhoc, &timestamp)?;
                    update_run(tx, run_id, &timestamp, RunUpdate::default())?;
                    side_effect = ResolvedSideEffect::StartNode {
                        node_row_id: new_id.clone(),
                    };
                    created_node_row_id = Some(new_id);
                }
                Transition::AdhocTurn {
                    node_row_id,
                    outcome,
                } => {
                    match outcome {
                        AdhocOutcome::Completed => {
                            complete_node(tx, node_row_id, &timestamp, None)?
                        }
                        AdhocOutcome::Failed(code) => fail_node(tx, node_row_id, *code)?,
                        AdhocOutcome::NeedsAttention => {
                            set_node_status(tx, node_row_id, WorkflowNodeStatus::NeedsAttention)?;
                        }
                    }
                    update_run(tx, run_id, &timestamp, RunUpdate::default())?;
                }
                Transition::Cancel {
                    node_row_id,
                    disposed_session_ids,
                } => {
                    // Mirrors FailNode/InterruptNode: the node row's own
                    // `completed_at` stays NULL (that column means "completed
                    // successfully"), only the run stamps its terminal time.
                    // The chain node's own `session_id` is NULLed exactly when
                    // its session is being disposed here (it was RUNNING),
                    // matching UndoAdvance's convention for a killed session;
                    // a disposed adhoc row keeps its historical session_id,
                    // same as any other resolved adhoc row.
                    let node_was_running = state
                        .node(node_row_id)
                        .map(|node| node.status == WorkflowNodeStatus::Running)
                        .unwrap_or(false);
                    if node_was_running {
                        tx.execute(
                            "UPDATE workflow_run_nodes SET status = 'cancelled', session_id = NULL
                             WHERE id = ?1",
                            params![node_row_id],
                        )?;
                    } else {
                        set_node_status(tx, node_row_id, WorkflowNodeStatus::Cancelled)?;
                    }
                    update_run(
                        tx,
                        run_id,
                        &timestamp,
                        RunUpdate {
                            status: Some(WorkflowRunStatus::Cancelled),
                            // A cancelled run no longer reads as
                            // interrupted-for-a-reason: ResumeNode and Redo
                            // both clear this column, cancel must too.
                            interruption_code: Some(None),
                            completed_at: Some(Some(timestamp.clone())),
                            ..RunUpdate::default()
                        },
                    )?;
                    if !disposed_session_ids.is_empty() {
                        side_effect = ResolvedSideEffect::DisposeSessions {
                            session_ids: disposed_session_ids.clone(),
                        };
                    }
                }
            }

            let state = Self::load_run_state_tx(tx, run_id)?
                .expect("the run row existed at the top of this transaction");
            Ok((
                AppliedTransition {
                    state,
                    side_effect,
                    created_node_row_id,
                },
                from_state,
            ))
        })?;

        // The tripwire: every committed transition must land on a lawful
        // state. Debug builds and tests panic here; the actor-rebuild sweep
        // covers release builds.
        #[cfg(debug_assertions)]
        super::invariants::report(&super::invariants::sweep(&applied.state));

        emit_transition_events(transition, &applied, from_state, event);
        Ok(applied)
    }

    /// Stamp the first finished turn of a node's current execution (idempotent
    /// past the first). The engine calls this on EVERY turn report before
    /// deciding, so the UndoAdvance window (Ruling J) closes even when the
    /// decision is a Hold.
    pub fn note_first_turn_finished(&self, node_row_id: &str) -> anyhow::Result<()> {
        self.db.with_tx_anyhow(|tx| {
            tx.execute(
                "UPDATE workflow_run_nodes SET first_turn_finished_at = ?2
                 WHERE id = ?1 AND first_turn_finished_at IS NULL",
                params![node_row_id, now()],
            )?;
            Ok(())
        })
    }

    /// Stamp the launched session onto its node row and emit
    /// `workflow.node.launched`. `agent_kind` comes from the launch call; the
    /// row does not store it.
    pub fn stamp_session(
        &self,
        node_row_id: &str,
        session_id: &str,
        prompt_id: Option<&str>,
        agent_kind: Option<&str>,
    ) -> anyhow::Result<()> {
        let (run_id, chain_index) = self.db.with_tx_anyhow(|tx| {
            tx.execute(
                "UPDATE workflow_run_nodes SET session_id = ?2, prompt_id = ?3 WHERE id = ?1",
                params![node_row_id, session_id, prompt_id],
            )?;
            let (run_id, chain_index): (String, Option<i64>) = tx.query_row(
                "SELECT run_id, chain_index FROM workflow_run_nodes WHERE id = ?1",
                params![node_row_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok((run_id, chain_index))
        })?;
        tracing::info!(
            target: WORKFLOW_NODE_LAUNCHED_TRACING_TARGET,
            run_id = %run_id,
            node_row_id = %node_row_id,
            session_id = %session_id,
            agent_kind = agent_kind.unwrap_or("unknown"),
            chain_index = chain_index.unwrap_or(-1),
            "workflow node launched",
        );
        Ok(())
    }

    /// Persist a freshly rendered envelope before launch, so retry and
    /// fail-and-redo re-create the exact prompt unit.
    pub fn store_rendered_envelope(
        &self,
        node_row_id: &str,
        envelope: &RenderedEnvelope,
    ) -> anyhow::Result<()> {
        let envelope_json = serde_json::to_string(envelope)?;
        self.db.with_tx_anyhow(|tx| {
            tx.execute(
                "UPDATE workflow_run_nodes SET rendered_envelope = ?2 WHERE id = ?1",
                params![node_row_id, envelope_json],
            )?;
            Ok(())
        })
    }

    pub fn load_run_state(&self, run_id: &str) -> anyhow::Result<Option<RunState>> {
        self.db
            .with_tx_anyhow(|tx| Self::load_run_state_tx(tx, run_id))
    }

    pub fn load_run_state_tx(tx: &Connection, run_id: &str) -> anyhow::Result<Option<RunState>> {
        let Some(run) = tx
            .query_row(
                "SELECT * FROM workflow_runs WHERE id = ?1",
                params![run_id],
                map_run,
            )
            .optional()?
        else {
            return Ok(None);
        };
        let mut statement = tx.prepare(
            "SELECT * FROM workflow_run_nodes WHERE run_id = ?1 ORDER BY created_at, rowid",
        )?;
        let nodes = statement
            .query_map(params![run_id], map_node)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some(RunState { run, nodes }))
    }

    pub fn list_docs(&self, run_id: &str) -> anyhow::Result<Vec<WorkflowRunDocRecord>> {
        self.db.with_tx_anyhow(|tx| Self::list_docs_tx(tx, run_id))
    }

    /// The full read projection of one run — run row, node rows, doc rows —
    /// loaded in ONE transaction so the API can never observe a torn read
    /// between the state and the doc registry.
    pub fn run_detail(&self, run_id: &str) -> anyhow::Result<Option<RunProjection>> {
        self.db.with_tx_anyhow(|tx| {
            let Some(state) = Self::load_run_state_tx(tx, run_id)? else {
                return Ok(None);
            };
            let docs = Self::list_docs_tx(tx, run_id)?;
            Ok(Some(project(&state, &docs)))
        })
    }

    /// Register a run-local doc after creation (an ad hoc or discovered
    /// document). The filename follows the same law as seeded rows: NN from
    /// the producing node's chain_index, bare `slug.md` without a producer.
    /// Run-local docs are the one place a producer is optional — template
    /// seeding always has one (validate() requires producingNodeId).
    /// Idempotent on (run_id, slug): re-registering returns the existing row.
    pub fn register_doc(
        &self,
        run_id: &str,
        slug: &str,
        producing_node_row_id: Option<&str>,
    ) -> anyhow::Result<WorkflowRunDocRecord> {
        self.db.with_tx_anyhow(|tx| {
            let existing = tx
                .query_row(
                    "SELECT * FROM workflow_run_docs WHERE run_id = ?1 AND slug = ?2",
                    params![run_id, slug],
                    map_doc,
                )
                .optional()?;
            if let Some(doc) = existing {
                return Ok(doc);
            }
            let chain_index: Option<i64> = match producing_node_row_id {
                Some(node_row_id) => tx.query_row(
                    "SELECT chain_index FROM workflow_run_nodes WHERE id = ?1 AND run_id = ?2",
                    params![node_row_id, run_id],
                    |row| row.get(0),
                )?,
                None => None,
            };
            let filename = registered_doc_filename(slug, chain_index);
            let timestamp = now();
            let id = mint_id();
            tx.execute(
                "INSERT INTO workflow_run_docs (
                    id, run_id, slug, filename, producing_node_row_id,
                    seeded_from_template, created_at, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
                params![id, run_id, slug, filename, producing_node_row_id, timestamp],
            )?;
            tx.query_row(
                "SELECT * FROM workflow_run_docs WHERE id = ?1",
                params![id],
                map_doc,
            )
            .map_err(Into::into)
        })
    }

    fn list_docs_tx(tx: &Connection, run_id: &str) -> anyhow::Result<Vec<WorkflowRunDocRecord>> {
        let mut statement = tx.prepare(
            "SELECT * FROM workflow_run_docs WHERE run_id = ?1 ORDER BY filename, rowid",
        )?;
        let docs = statement
            .query_map(params![run_id], map_doc)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(docs)
    }

    /// The id of the non-terminal run occupying `workspace_id`, if any — the
    /// one-live-run law's read (Ruling B).
    pub fn non_terminal_run_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<String>> {
        self.db
            .with_tx_anyhow(|tx| Self::non_terminal_run_for_workspace_tx(tx, workspace_id))
    }

    fn non_terminal_run_for_workspace_tx(
        tx: &Connection,
        workspace_id: &str,
    ) -> anyhow::Result<Option<String>> {
        tx.query_row(
            "SELECT id FROM workflow_runs
             WHERE workspace_id = ?1 AND status IN ('running', 'awaiting_human', 'interrupted')
             LIMIT 1",
            params![workspace_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    /// One cheap read for the command routes' pre-dispatch 404s: run missing,
    /// node missing on the run, or present.
    pub fn node_membership(
        &self,
        run_id: &str,
        node_row_id: &str,
    ) -> anyhow::Result<NodeMembership> {
        self.db.with_tx_anyhow(|tx| {
            let run_exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM workflow_runs WHERE id = ?1)",
                params![run_id],
                |row| row.get(0),
            )?;
            if !run_exists {
                return Ok(NodeMembership::RunMissing);
            }
            let node_exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM workflow_run_nodes WHERE run_id = ?1 AND id = ?2)",
                params![run_id, node_row_id],
                |row| row.get(0),
            )?;
            Ok(if node_exists {
                NodeMembership::Present
            } else {
                NodeMembership::NodeMissing
            })
        })
    }

    /// Every run row, newest first — the unfiltered list route.
    pub fn all_runs(&self) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.db.with_tx_anyhow(|tx| {
            let mut statement =
                tx.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC, rowid DESC")?;
            let runs = statement
                .query_map([], map_run)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(runs)
        })
    }

    pub fn runs_for_workspace(&self, workspace_id: &str) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.db.with_tx_anyhow(|tx| {
            let mut statement = tx.prepare(
                "SELECT * FROM workflow_runs WHERE workspace_id = ?1
                 ORDER BY created_at DESC, rowid DESC",
            )?;
            // Per-row lenient: one unreadable row (a value a newer binary
            // wrote) must not brick the whole listing.
            let runs = statement
                .query_map(params![workspace_id], map_run)?
                .filter_map(|row| match row {
                    Ok(run) => Some(run),
                    Err(error) => {
                        tracing::error!(
                            workspace_id = %workspace_id,
                            %error,
                            "skipping unreadable workflow run row in listing",
                        );
                        None
                    }
                })
                .collect();
            Ok(runs)
        })
    }

    /// The boot fence's sweep set (Ruling K): every run with ANY node row in
    /// `running` status — chain or adhoc — plus runs whose own status claims
    /// live execution. `awaiting_human` and `interrupted` runs with no
    /// running nodes are durable parks and survive a restart untouched.
    pub fn boot_fence_run_ids(&self) -> anyhow::Result<Vec<String>> {
        self.db.with_tx_anyhow(|tx| {
            let mut statement = tx.prepare(
                "SELECT DISTINCT r.id FROM workflow_runs r
                 LEFT JOIN workflow_run_nodes n ON n.run_id = r.id AND n.status = 'running'
                 WHERE r.status = 'running' OR n.id IS NOT NULL
                 ORDER BY r.rowid",
            )?;
            let ids = statement
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            Ok(ids)
        })
    }

    /// Emit the boot-fence summary event once the sweep fenced its runs.
    pub fn emit_boot_fence_summary(fenced_run_ids: &[String]) {
        if fenced_run_ids.is_empty() {
            return;
        }
        tracing::warn!(
            target: WORKFLOW_BOOT_FENCE_TRACING_TARGET,
            fenced_count = fenced_run_ids.len(),
            run_ids = %fenced_run_ids.join(","),
            "workflow boot fence marked runs interrupted",
        );
    }
}

/// Emit the non-transition decision events: a Hold on a turn report is either
/// the staleness guard firing or the queued-interjection hold (told apart by
/// `queue_empty` — a held report with a non-empty queue is the node staying
/// open on purpose); an Illegal is the refused command/report
/// (`workflow.transition.illegal`). The engine calls this on every decision;
/// applied transitions emit inside `apply_transition`.
pub fn emit_decision_events(run_id: &str, event: &WorkflowEvent, decision: &Decision) {
    match decision {
        Decision::Transition(_) => {}
        Decision::Hold => {
            if let WorkflowEvent::TurnFinished(turn) = event {
                // Accepted imprecision: classified by the TurnFinished payload
                // (stop_reason + queue_empty), not by which transition-table
                // rule produced this Hold — a truly stale report arriving
                // with a non-empty queue would be routed here too. Telling
                // those apart needs a `HoldReason` payload on `Decision`,
                // out of instrumentation-only scope.
                if turn.stop_reason == TurnStopReason::CleanEndTurn && !turn.queue_empty {
                    tracing::info!(
                        target: WORKFLOW_INTERJECTION_HELD_TRACING_TARGET,
                        run_id = %run_id,
                        node_row_id = %turn.node_row_id,
                        stop_reason = turn.stop_reason.as_str(),
                        queue_empty = turn.queue_empty,
                        "workflow interjection held",
                    );
                } else {
                    tracing::warn!(
                        target: WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET,
                        run_id = %run_id,
                        node_row_id = %turn.node_row_id,
                        stop_reason = turn.stop_reason.as_str(),
                        queue_empty = turn.queue_empty,
                        "workflow turn report held",
                    );
                }
            }
        }
        Decision::Illegal(illegal) => {
            tracing::warn!(
                target: WORKFLOW_TRANSITION_ILLEGAL_TRACING_TARGET,
                run_id = %run_id,
                command = %illegal.command,
                node_state = illegal.node_state.as_deref().unwrap_or("none"),
                run_state = %illegal.run_state,
                detail = %illegal.detail,
                "illegal workflow transition refused",
            );
        }
    }
}

/// The filename law: `NN-slug.md`, NN = the producing node's chain position,
/// zero-based, two digits. Every context-doc filename in the system derives
/// from this one function.
pub(crate) fn doc_filename(slug: &str, producing_chain_index: i64) -> String {
    format!("{producing_chain_index:02}-{slug}.md")
}

/// The run-local variant: registered docs may have no producing node (a doc
/// discovered mid-run), in which case the filename is the bare `slug.md`.
/// Template-seeded rows never take this branch — validate() requires their
/// producer. `UNIQUE(run_id, filename)` guards the two laws from colliding.
fn registered_doc_filename(slug: &str, producing_chain_index: Option<i64>) -> String {
    match producing_chain_index {
        Some(index) => doc_filename(slug, index),
        None => format!("{slug}.md"),
    }
}

#[derive(Default)]
struct RunUpdate {
    status: Option<WorkflowRunStatus>,
    /// `Some(None)` clears the column.
    current_node_row_id: Option<Option<String>>,
    failure_code: Option<Option<String>>,
    interruption_code: Option<Option<String>>,
    completed_at: Option<Option<String>>,
}

/// One UPDATE statement for every requested column. Single-statement matters:
/// the failed⇔failure_code CHECK is evaluated per statement, so status and
/// code must always land together.
fn update_run(
    tx: &Connection,
    run_id: &str,
    timestamp: &str,
    update: RunUpdate,
) -> rusqlite::Result<()> {
    let mut sql = String::from("UPDATE workflow_runs SET updated_at = ?1");
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(timestamp.to_string())];
    fn set(
        sql: &mut String,
        values: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
        column: &str,
        value: Box<dyn rusqlite::types::ToSql>,
    ) {
        values.push(value);
        sql.push_str(&format!(", {column} = ?{}", values.len()));
    }
    if let Some(status) = update.status {
        set(&mut sql, &mut values, "status", Box::new(status.as_str()));
    }
    if let Some(current) = update.current_node_row_id {
        set(
            &mut sql,
            &mut values,
            "current_node_row_id",
            Box::new(current),
        );
    }
    if let Some(code) = update.failure_code {
        set(&mut sql, &mut values, "failure_code", Box::new(code));
    }
    if let Some(code) = update.interruption_code {
        set(&mut sql, &mut values, "interruption_code", Box::new(code));
    }
    if let Some(completed_at) = update.completed_at {
        set(
            &mut sql,
            &mut values,
            "completed_at",
            Box::new(completed_at),
        );
    }
    values.push(Box::new(run_id.to_string()));
    sql.push_str(&format!(" WHERE id = ?{}", values.len()));
    tx.execute(
        &sql,
        rusqlite::params_from_iter(values.iter().map(|value| value.as_ref())),
    )?;
    Ok(())
}

fn set_node_status(
    tx: &Connection,
    node_row_id: &str,
    status: WorkflowNodeStatus,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes SET status = ?2 WHERE id = ?1",
        params![node_row_id, status.as_str()],
    )?;
    Ok(())
}

/// Status and code in one statement (the failed⇔code CHECK is per-statement).
fn fail_node(
    tx: &Connection,
    node_row_id: &str,
    code: WorkflowNodeFailureCode,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes SET status = 'failed', failure_code = ?2 WHERE id = ?1",
        params![node_row_id, code.as_str()],
    )?;
    Ok(())
}

/// A redo's superseded row: failed, keeping its own failure code when it
/// already had one, `superseded` when it was replaced from a non-failed pause.
fn supersede_node(tx: &Connection, node_row_id: &str) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes
         SET status = 'failed', failure_code = COALESCE(failure_code, 'superseded')
         WHERE id = ?1",
        params![node_row_id],
    )?;
    Ok(())
}

fn complete_node(
    tx: &Connection,
    node_row_id: &str,
    timestamp: &str,
    node_type: Option<WorkflowNodeType>,
) -> rusqlite::Result<()> {
    match node_type {
        Some(node_type) => tx.execute(
            "UPDATE workflow_run_nodes
             SET status = 'completed', completed_at = ?2, node_type = ?3
             WHERE id = ?1",
            params![node_row_id, timestamp, node_type.as_str()],
        )?,
        None => tx.execute(
            "UPDATE workflow_run_nodes SET status = 'completed', completed_at = ?2 WHERE id = ?1",
            params![node_row_id, timestamp],
        )?,
    };
    Ok(())
}

fn start_node_row(tx: &Connection, node_row_id: &str, timestamp: &str) -> rusqlite::Result<()> {
    // A (re)start is a fresh execution: the undo window reopens with it.
    tx.execute(
        "UPDATE workflow_run_nodes
         SET status = 'running', started_at = ?2, first_turn_finished_at = NULL
         WHERE id = ?1",
        params![node_row_id, timestamp],
    )?;
    Ok(())
}

fn insert_new_node(
    tx: &Connection,
    run_id: &str,
    spec: &NewNodeSpec,
    timestamp: &str,
) -> anyhow::Result<String> {
    let id = mint_id();
    let envelope_json = spec
        .rendered_envelope
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let model_json = spec.model.as_ref().map(serde_json::to_string).transpose()?;
    tx.execute(
        "INSERT INTO workflow_run_nodes (
            id, run_id, definition_node_id, kind, node_type,
            replaces_node_row_id, anchor_node_row_id, chain_index,
            title, prompt, status, session_id, prompt_id, model,
            rendered_envelope, failure_code, created_at, started_at, completed_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'running',
                 NULL, NULL, ?11, ?12, NULL, ?13, ?13, NULL)",
        params![
            id,
            run_id,
            spec.definition_node_id,
            spec.kind.as_str(),
            spec.node_type.as_str(),
            spec.replaces_node_row_id,
            spec.anchor_node_row_id,
            spec.chain_index,
            spec.title,
            spec.prompt,
            model_json,
            envelope_json,
            timestamp,
        ],
    )?;
    Ok(id)
}

fn emit_transition_events(
    transition: &Transition,
    applied: &AppliedTransition,
    from_state: WorkflowRunStatus,
    event: &WorkflowEvent,
) {
    // `cause` + `stop_reason` distinguish ADR table rows that share one
    // transition shape (turn advance vs approve gate vs flip-gate-to-agent
    // all persist an AdvanceToNext).
    let (cause, stop_reason) = match event {
        WorkflowEvent::Command(command) => (command.as_str(), None),
        WorkflowEvent::TurnFinished(turn) => ("turn_finished", Some(turn.stop_reason.as_str())),
        WorkflowEvent::BootFence { .. } => ("boot_fence", None),
        WorkflowEvent::NodeLaunchFailed { .. } => ("node_launch_failed", None),
    };
    let node_row_id = transition_node_row_id(transition, applied);
    // The classification a failing transition carries, so a node_failed row is
    // diagnosable from the event alone (empty on every non-failing shape).
    let failure_code = match transition {
        Transition::FailNode { code, .. } => code.as_str(),
        Transition::AdhocTurn {
            outcome: AdhocOutcome::Failed(code),
            ..
        } => code.as_str(),
        _ => "",
    };
    tracing::info!(
        target: WORKFLOW_TRANSITION_TRACING_TARGET,
        run_id = %applied.state.run.id,
        node_row_id = node_row_id.unwrap_or("none"),
        event = transition.label(),
        cause = cause,
        stop_reason = stop_reason.unwrap_or(""),
        failure_code = failure_code,
        from_state = from_state.as_str(),
        to_state = applied.state.run.status.as_str(),
        "workflow transition applied",
    );
    if let Transition::FailNode {
        node_row_id,
        code: WorkflowNodeFailureCode::NodeLaunchFailed,
    } = transition
    {
        tracing::error!(
            target: WORKFLOW_NODE_LAUNCH_FAILED_TRACING_TARGET,
            run_id = %applied.state.run.id,
            node_row_id = %node_row_id,
            code = WorkflowNodeFailureCode::NodeLaunchFailed.as_str(),
            "workflow node launch failed",
        );
    }
    if applied.state.run.status.is_terminal() && !from_state.is_terminal() {
        let nodes_completed = applied
            .state
            .nodes
            .iter()
            .filter(|node| node.status == WorkflowNodeStatus::Completed)
            .count();
        let nodes_failed = applied
            .state
            .nodes
            .iter()
            .filter(|node| node.status == WorkflowNodeStatus::Failed)
            .count();
        tracing::info!(
            target: WORKFLOW_RUN_FINISHED_TRACING_TARGET,
            run_id = %applied.state.run.id,
            status = applied.state.run.status.as_str(),
            failure_code = applied.state.run.failure_code.as_deref().unwrap_or(""),
            nodes_completed,
            nodes_failed,
            "workflow run finished",
        );
    }
}

fn transition_node_row_id<'a>(
    transition: &'a Transition,
    applied: &'a AppliedTransition,
) -> Option<&'a str> {
    match transition {
        Transition::AdvanceToNext {
            next_node_row_id, ..
        } => Some(next_node_row_id),
        Transition::CompleteRun {
            completed_node_row_id,
            ..
        } => Some(completed_node_row_id),
        Transition::GateNode { node_row_id }
        | Transition::FailNode { node_row_id, .. }
        | Transition::InterruptNode { node_row_id, .. }
        | Transition::FlipNodeType { node_row_id, .. }
        | Transition::ResumeNode { node_row_id }
        | Transition::AdhocTurn { node_row_id, .. }
        | Transition::Cancel { node_row_id, .. } => Some(node_row_id),
        Transition::Redo { .. } | Transition::AddAdhoc { .. } => {
            applied.created_node_row_id.as_deref()
        }
        Transition::UndoAdvance {
            undone_node_row_id, ..
        } => Some(undone_node_row_id),
        Transition::Fence { node_row_ids, .. } => node_row_ids.first().map(String::as_str),
    }
}

fn map_run(row: &Row<'_>) -> rusqlite::Result<WorkflowRunRecord> {
    Ok(WorkflowRunRecord {
        id: row.get("id")?,
        invocation_id: row.get("invocation_id")?,
        definition_json: row.get("definition_json")?,
        arguments_json: row.get("arguments_json")?,
        workspace_id: row.get("workspace_id")?,
        status: parse_text(row.get::<_, String>("status")?.as_str(), "run status", |s| {
            WorkflowRunStatus::parse(s)
        })?,
        current_node_row_id: row.get("current_node_row_id")?,
        failure_code: row.get("failure_code")?,
        // Lenient: an unknown code (written by a newer binary) degrades to
        // None with an error event instead of bricking the read path.
        interruption_code: row
            .get::<_, Option<String>>("interruption_code")?
            .and_then(|code| {
                let parsed = super::model::WorkflowInterruptionCode::parse(&code);
                if parsed.is_none() {
                    tracing::error!(code = %code, "unknown workflow run interruption_code; reading as none");
                }
                parsed
            }),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn map_node(row: &Row<'_>) -> rusqlite::Result<WorkflowRunNodeRecord> {
    // Lenient: a corrupt or newer-schema envelope degrades to None (the
    // engine re-renders) instead of bricking every read of the run.
    let envelope = row
        .get::<_, Option<String>>("rendered_envelope")?
        .and_then(|json| match serde_json::from_str::<RenderedEnvelope>(&json) {
            Ok(envelope) => Some(envelope),
            Err(error) => {
                tracing::error!(%error, "unreadable workflow node rendered_envelope; reading as none");
                None
            }
        });
    // Same leniency: an unreadable model pick degrades to the default
    // resolution path instead of bricking the run's reads.
    let model = row
        .get::<_, Option<String>>("model")?
        .and_then(|json| match serde_json::from_str(&json) {
            Ok(model) => Some(model),
            Err(error) => {
                tracing::error!(%error, "unreadable workflow node model; reading as none");
                None
            }
        });
    Ok(WorkflowRunNodeRecord {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        definition_node_id: row.get("definition_node_id")?,
        kind: parse_text(row.get::<_, String>("kind")?.as_str(), "node kind", |s| {
            WorkflowNodeKind::parse(s)
        })?,
        node_type: parse_text(
            row.get::<_, String>("node_type")?.as_str(),
            "node type",
            WorkflowNodeType::parse,
        )?,
        replaces_node_row_id: row.get("replaces_node_row_id")?,
        anchor_node_row_id: row.get("anchor_node_row_id")?,
        chain_index: row.get("chain_index")?,
        title: row.get("title")?,
        prompt: row.get("prompt")?,
        status: parse_text(
            row.get::<_, String>("status")?.as_str(),
            "node status",
            WorkflowNodeStatus::parse,
        )?,
        session_id: row.get("session_id")?,
        prompt_id: row.get("prompt_id")?,
        model,
        rendered_envelope: envelope,
        failure_code: row
            .get::<_, Option<String>>("failure_code")?
            .and_then(|code| {
                let parsed = WorkflowNodeFailureCode::parse(&code);
                if parsed.is_none() {
                    tracing::error!(code = %code, "unknown workflow node failure_code; reading as none");
                }
                parsed
            }),
        first_turn_finished_at: row.get("first_turn_finished_at")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn map_doc(row: &Row<'_>) -> rusqlite::Result<WorkflowRunDocRecord> {
    Ok(WorkflowRunDocRecord {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        slug: row.get("slug")?,
        filename: row.get("filename")?,
        producing_node_row_id: row.get("producing_node_row_id")?,
        seeded_from_template: row.get::<_, i64>("seeded_from_template")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_text<T>(
    value: &str,
    what: &'static str,
    parse: impl Fn(&str) -> Option<T>,
) -> rusqlite::Result<T> {
    parse(value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown {what}: {value}").into(),
        )
    })
}
