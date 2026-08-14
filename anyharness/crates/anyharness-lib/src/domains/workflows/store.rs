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
use super::transition::{AdhocOutcome, NewNodeSpec, RunState, Transition};
use crate::observability::{
    WORKFLOW_BOOT_FENCE_TRACING_TARGET, WORKFLOW_NODE_LAUNCHED_TRACING_TARGET,
    WORKFLOW_NODE_LAUNCH_FAILED_TRACING_TARGET, WORKFLOW_RUN_FINISHED_TRACING_TARGET,
    WORKFLOW_RUN_STARTED_TRACING_TARGET, WORKFLOW_TRANSITION_TRACING_TARGET,
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
    StartNode { node_row_id: String },
    DisposeSession { session_id: String },
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

            let timestamp = now();
            let definition = &params.snapshot.definition;
            let arguments_json = serde_json::to_string(&params.snapshot.arguments)?;
            let definition_json = serde_json::to_string(definition)?;

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
                        title, prompt, status, session_id, prompt_id,
                        rendered_envelope, failure_code, created_at, started_at, completed_at
                     )
                     VALUES (?1, ?2, ?3, 'defined', ?4, NULL, NULL, ?5, ?6, ?7, ?8,
                             NULL, NULL, NULL, NULL, ?9, ?10, NULL)",
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
                        if first { Some(timestamp.as_str()) } else { None },
                    ],
                )?;
            }

            for template in &definition.doc_templates {
                let producing_position = template.producing_node_id.as_deref().and_then(|id| {
                    chain
                        .iter()
                        .position(|definition_node_id| definition_node_id == id)
                });
                let filename = match producing_position {
                    Some(position) => format!("{position:02}-{}.md", template.slug),
                    // No producing node: a shared seed doc, no NN prefix.
                    None => format!("{}.md", template.slug),
                };
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
                        producing_position.map(|position| row_ids[position].as_str()),
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
    /// emit the transition's named events. The caller performs the returned
    /// side effect only after this returns.
    pub fn apply_transition(
        &self,
        run_id: &str,
        transition: &Transition,
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
                } => {
                    complete_node(tx, completed_node_row_id, &timestamp)?;
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
                } => {
                    complete_node(tx, completed_node_row_id, &timestamp)?;
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
                    set_node_status(tx, node_row_id, WorkflowNodeStatus::Failed)?;
                    set_node_failure_code(tx, node_row_id, Some(*code))?;
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
                } => {
                    set_node_status(tx, failed_node_row_id, WorkflowNodeStatus::Failed)?;
                    let new_id = insert_new_node(tx, run_id, replacement, &timestamp)?;
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
                            ..RunUpdate::default()
                        },
                    )?;
                    side_effect = ResolvedSideEffect::StartNode {
                        node_row_id: new_id.clone(),
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
                             started_at = NULL
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
                Transition::Fence { node_row_id, code } => {
                    if let Some(node_row_id) = node_row_id {
                        set_node_status(tx, node_row_id, WorkflowNodeStatus::NeedsAttention)?;
                    }
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
                Transition::ResumeNode { node_row_id } => {
                    // A fresh session re-runs the node: the old link clears
                    // now, the new session stamps after launch.
                    tx.execute(
                        "UPDATE workflow_run_nodes
                         SET status = 'running', session_id = NULL, prompt_id = NULL,
                             failure_code = NULL, started_at = ?2
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
                        AdhocOutcome::Completed => complete_node(tx, node_row_id, &timestamp)?,
                        AdhocOutcome::Failed(code) => {
                            set_node_status(tx, node_row_id, WorkflowNodeStatus::Failed)?;
                            set_node_failure_code(tx, node_row_id, Some(*code))?;
                        }
                        AdhocOutcome::NeedsAttention => {
                            set_node_status(tx, node_row_id, WorkflowNodeStatus::NeedsAttention)?;
                        }
                    }
                    update_run(tx, run_id, &timestamp, RunUpdate::default())?;
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

        emit_transition_events(transition, &applied, from_state);
        Ok(applied)
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

    fn list_docs_tx(tx: &Connection, run_id: &str) -> anyhow::Result<Vec<WorkflowRunDocRecord>> {
        let mut statement = tx.prepare(
            "SELECT * FROM workflow_run_docs WHERE run_id = ?1 ORDER BY filename, rowid",
        )?;
        let docs = statement
            .query_map(params![run_id], map_doc)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(docs)
    }

    pub fn runs_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.db.with_tx_anyhow(|tx| {
            let mut statement = tx.prepare(
                "SELECT * FROM workflow_runs WHERE workspace_id = ?1
                 ORDER BY created_at DESC, rowid DESC",
            )?;
            let runs = statement
                .query_map(params![workspace_id], map_run)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(runs)
        })
    }

    /// The boot fence's sweep set: runs whose status claims live execution.
    /// `awaiting_human` and `interrupted` runs are durable parks and survive a
    /// restart untouched.
    pub fn running_run_ids(&self) -> anyhow::Result<Vec<String>> {
        self.db.with_tx_anyhow(|tx| {
            let mut statement =
                tx.prepare("SELECT id FROM workflow_runs WHERE status = 'running' ORDER BY rowid")?;
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

#[derive(Default)]
struct RunUpdate {
    status: Option<WorkflowRunStatus>,
    /// `Some(None)` clears the column.
    current_node_row_id: Option<Option<String>>,
    failure_code: Option<Option<String>>,
    interruption_code: Option<Option<String>>,
    completed_at: Option<Option<String>>,
}

fn update_run(
    tx: &Connection,
    run_id: &str,
    timestamp: &str,
    update: RunUpdate,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_runs SET updated_at = ?2 WHERE id = ?1",
        params![run_id, timestamp],
    )?;
    if let Some(status) = update.status {
        tx.execute(
            "UPDATE workflow_runs SET status = ?2 WHERE id = ?1",
            params![run_id, status.as_str()],
        )?;
    }
    if let Some(current) = update.current_node_row_id {
        tx.execute(
            "UPDATE workflow_runs SET current_node_row_id = ?2 WHERE id = ?1",
            params![run_id, current],
        )?;
    }
    if let Some(code) = update.failure_code {
        tx.execute(
            "UPDATE workflow_runs SET failure_code = ?2 WHERE id = ?1",
            params![run_id, code],
        )?;
    }
    if let Some(code) = update.interruption_code {
        tx.execute(
            "UPDATE workflow_runs SET interruption_code = ?2 WHERE id = ?1",
            params![run_id, code],
        )?;
    }
    if let Some(completed_at) = update.completed_at {
        tx.execute(
            "UPDATE workflow_runs SET completed_at = ?2 WHERE id = ?1",
            params![run_id, completed_at],
        )?;
    }
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

fn set_node_failure_code(
    tx: &Connection,
    node_row_id: &str,
    code: Option<WorkflowNodeFailureCode>,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes SET failure_code = ?2 WHERE id = ?1",
        params![node_row_id, code.map(|code| code.as_str())],
    )?;
    Ok(())
}

fn complete_node(tx: &Connection, node_row_id: &str, timestamp: &str) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes SET status = 'completed', completed_at = ?2 WHERE id = ?1",
        params![node_row_id, timestamp],
    )?;
    Ok(())
}

fn start_node_row(tx: &Connection, node_row_id: &str, timestamp: &str) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_run_nodes SET status = 'running', started_at = ?2 WHERE id = ?1",
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
    tx.execute(
        "INSERT INTO workflow_run_nodes (
            id, run_id, definition_node_id, kind, node_type,
            replaces_node_row_id, anchor_node_row_id, chain_index,
            title, prompt, status, session_id, prompt_id,
            rendered_envelope, failure_code, created_at, started_at, completed_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'running',
                 NULL, NULL, ?11, NULL, ?12, ?12, NULL)",
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
) {
    let node_row_id = transition_node_row_id(transition, applied);
    tracing::info!(
        target: WORKFLOW_TRANSITION_TRACING_TARGET,
        run_id = %applied.state.run.id,
        node_row_id = node_row_id.unwrap_or("none"),
        event = transition.label(),
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
        } => Some(completed_node_row_id),
        Transition::GateNode { node_row_id }
        | Transition::FailNode { node_row_id, .. }
        | Transition::InterruptNode { node_row_id, .. }
        | Transition::FlipNodeType { node_row_id, .. }
        | Transition::ResumeNode { node_row_id }
        | Transition::AdhocTurn { node_row_id, .. } => Some(node_row_id),
        Transition::Redo { .. } | Transition::AddAdhoc { .. } => {
            applied.created_node_row_id.as_deref()
        }
        Transition::UndoAdvance {
            undone_node_row_id, ..
        } => Some(undone_node_row_id),
        Transition::Fence { node_row_id, .. } => node_row_id.as_deref(),
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
        interruption_code: row
            .get::<_, Option<String>>("interruption_code")?
            .map(|code| {
                parse_text(&code, "run interruption_code", |s| {
                    super::model::WorkflowInterruptionCode::parse(s)
                })
            })
            .transpose()?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn map_node(row: &Row<'_>) -> rusqlite::Result<WorkflowRunNodeRecord> {
    let envelope = row
        .get::<_, Option<String>>("rendered_envelope")?
        .map(|json| {
            serde_json::from_str::<RenderedEnvelope>(&json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
            })
        })
        .transpose()?;
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
            |s| WorkflowNodeType::parse(s),
        )?,
        replaces_node_row_id: row.get("replaces_node_row_id")?,
        anchor_node_row_id: row.get("anchor_node_row_id")?,
        chain_index: row.get("chain_index")?,
        title: row.get("title")?,
        prompt: row.get("prompt")?,
        status: parse_text(
            row.get::<_, String>("status")?.as_str(),
            "node status",
            |s| WorkflowNodeStatus::parse(s),
        )?,
        session_id: row.get("session_id")?,
        prompt_id: row.get("prompt_id")?,
        rendered_envelope: envelope,
        failure_code: row
            .get::<_, Option<String>>("failure_code")?
            .map(|code| {
                parse_text(&code, "node failure_code", |s| {
                    WorkflowNodeFailureCode::parse(s)
                })
            })
            .transpose()?,
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
