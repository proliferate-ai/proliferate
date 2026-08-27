//! The per-run workflow actor: one task, two inbound channels, nothing else
//! can wake it. Commands arrive with a oneshot whose reply IS the HTTP
//! response; turn reports arrive fire-and-forget from the session extension.
//! In-memory state is a cache of the rows — loaded at spawn, updated only
//! after a commit — and every decision comes from the pure transition table.
//! Persist first, side effects inline after the commit, ordering by
//! construction: a per-run actor is single-threaded on purpose.

use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot};

use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::runtime::{
    InternalSessionCreateInput, SessionRuntime, TextPromptDispatchError,
};
use crate::domains::sessions::store::SessionStore;
use crate::domains::workflows::definition::{ResolveMode, WorkflowDefinition};
use crate::domains::workflows::model::{RenderedEnvelope, WorkflowNodeKind, WorkflowRunNodeRecord};
use crate::domains::workflows::projection::RunProjection;
use crate::domains::workflows::render::{
    node_session_title, render_envelope, run_context_dir_relative, RenderInputs,
};
use crate::domains::workflows::store::{emit_decision_events, ResolvedSideEffect, WorkflowStore};
use crate::domains::workflows::transition::{
    next, Decision, IllegalTransition, RunState, TurnFinished, WorkflowCommand, WorkflowEvent,
};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::observability::WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET;
use crate::origin::OriginContext;

/// The default agent for nodes without a model pick (RULED: the boring
/// app-default harness; the definition's `NodeModel` overrides all three).
pub(super) const DEFAULT_WORKFLOW_AGENT_KIND: &str = "claude";

pub(super) type CommandReply = oneshot::Sender<Result<RunProjection, IllegalTransition>>;

/// Everything an actor touches beyond its own channels. Shared with the
/// manager, which spawns actors from the same dependency set.
pub(super) struct WorkflowActorDeps {
    pub store: WorkflowStore,
    pub session_runtime: Arc<SessionRuntime>,
    pub session_store: SessionStore,
    pub workspace_store: WorkspaceStore,
}

pub(super) struct WorkflowActor {
    pub run_id: String,
    pub deps: Arc<WorkflowActorDeps>,
    pub commands: mpsc::Receiver<(super::ActorRequest, CommandReply)>,
    pub notifications: mpsc::UnboundedReceiver<TurnFinished>,
}

/// Why a step produced no fresh projection: the table refused it (the 409),
/// or persistence itself failed (the reply oneshot is dropped and the manager
/// answers Internal — never a fabricated success or a fabricated 409).
enum StepError {
    Illegal(IllegalTransition),
    Infra,
}

impl WorkflowActor {
    pub(super) async fn run(mut self, mut state: RunState) {
        // The one launch rule: a `running` current node with no linked session
        // is a node whose session was never born — the create-then-start seam
        // hands the actor exactly this shape, and a Resume that raced a crash
        // heals through the same path at the next touch.
        self.launch_current_if_unlinked(&mut state).await;

        loop {
            tokio::select! {
                command = self.commands.recv() => {
                    let Some((request, reply)) = command else { break };
                    let command = match request {
                        super::ActorRequest::Command(command) => command,
                        super::ActorRequest::ReadProjection => {
                            match self.deps.store.run_detail(&self.run_id) {
                                Ok(Some(projection)) => { let _ = reply.send(Ok(projection)); }
                                Ok(None) | Err(_) => drop(reply), // infra: caller sees Internal
                            }
                            continue;
                        }
                    };
                    match self.step(&mut state, WorkflowEvent::Command(command)).await {
                        Ok(()) => {
                            match self.deps.store.run_detail(&self.run_id) {
                                Ok(Some(projection)) => { let _ = reply.send(Ok(projection)); }
                                Ok(None) | Err(_) => drop(reply), // infra: caller sees Internal
                            }
                        }
                        Err(StepError::Illegal(illegal)) => { let _ = reply.send(Err(illegal)); }
                        Err(StepError::Infra) => drop(reply),
                    }
                }
                note = self.notifications.recv() => {
                    let Some(turn) = note else { break };
                    if self.note_is_stale(&state, &turn) {
                        continue;
                    }
                    // Close the undo window (Ruling J) on EVERY live report
                    // BEFORE deciding — a Hold (queued interjection) must
                    // still close it — and catch the cache up so a racing
                    // UndoAdvance command is judged on the stamped row.
                    // Stale reports never reach this: a post-undo straggler
                    // must not close the window undo just reopened.
                    self.stamp_first_turn(&mut state, &turn.node_row_id);
                    // Nobody to answer: Hold and Illegal alike end here.
                    let _ = self.step(&mut state, WorkflowEvent::TurnFinished(turn)).await;
                }
            }
        }
        // Both senders dropped: process shutdown. Rows are the record.
    }

    /// One event through the machine: decide purely, emit the decision's
    /// event, persist first, catch the cache up, then perform the side effect
    /// the committed transition names.
    async fn step(&self, state: &mut RunState, event: WorkflowEvent) -> Result<(), StepError> {
        let decision = next(state, &event);
        emit_decision_events(&self.run_id, &event, &decision);
        let transition = match decision {
            Decision::Transition(transition) => transition,
            Decision::Hold => return Ok(()),
            Decision::Illegal(illegal) => return Err(StepError::Illegal(illegal)),
        };
        let applied = self
            .deps
            .store
            .apply_transition(&self.run_id, &transition, &event)
            .map_err(|error| {
                tracing::error!(
                    run_id = %self.run_id,
                    transition = transition.label(),
                    error = %error,
                    "workflow transition persist failed; rows stay pre-transition",
                );
                StepError::Infra
            })?;
        *state = applied.state.clone();
        self.perform_side_effect(state, applied.side_effect).await;
        Ok(())
    }

    /// Side effects run inline on this loop, after the commit. A failed launch
    /// feeds `NodeLaunchFailed` back through the table as a plain loop (the
    /// failure transition's own side effect is always `None`, so this
    /// terminates by construction).
    async fn perform_side_effect(&self, state: &mut RunState, effect: ResolvedSideEffect) {
        let mut effect = effect;
        loop {
            match effect {
                ResolvedSideEffect::None => break,
                ResolvedSideEffect::DisposeSession { session_id } => {
                    self.dispose_session(&session_id).await;
                    break;
                }
                ResolvedSideEffect::DisposeSessions { session_ids } => {
                    // Cancel's compound effect: every running row's session,
                    // chain or adhoc. Nothing starts after — the run is
                    // terminal.
                    for session_id in &session_ids {
                        self.dispose_session(session_id).await;
                    }
                    break;
                }
                ResolvedSideEffect::DisposeThenStart {
                    session_id,
                    node_row_id,
                } => {
                    // Ruling L: kill the wedged session the redo took over
                    // from, then fall through to the plain launch.
                    self.dispose_session(&session_id).await;
                    effect = ResolvedSideEffect::StartNode { node_row_id };
                }
                ResolvedSideEffect::StartNode { node_row_id } => {
                    match self.launch_node(state, &node_row_id).await {
                        Ok(()) => break,
                        Err(error) => {
                            tracing::warn!(
                                run_id = %self.run_id,
                                node_row_id = %node_row_id,
                                error = %error,
                                "workflow node launch failed",
                            );
                            let event = WorkflowEvent::NodeLaunchFailed {
                                node_row_id: node_row_id.clone(),
                            };
                            let transition = match next(state, &event) {
                                Decision::Transition(transition) => transition,
                                Decision::Hold | Decision::Illegal(_) => break,
                            };
                            match self.deps.store.apply_transition(
                                &self.run_id,
                                &transition,
                                &event,
                            ) {
                                Ok(applied) => {
                                    *state = applied.state.clone();
                                    effect = applied.side_effect;
                                }
                                Err(persist_error) => {
                                    tracing::error!(
                                        run_id = %self.run_id,
                                        error = %persist_error,
                                        "workflow launch-failure persist failed; the fence resolves the row",
                                    );
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    async fn launch_current_if_unlinked(&self, state: &mut RunState) {
        let unlinked_current = state
            .current_node()
            .filter(|node| {
                state.run.status == crate::domains::workflows::model::WorkflowRunStatus::Running
                    && node.status == crate::domains::workflows::model::WorkflowNodeStatus::Running
                    && node.session_id.is_none()
            })
            .map(|node| node.id.clone());
        if let Some(node_row_id) = unlinked_current {
            self.perform_side_effect(state, ResolvedSideEffect::StartNode { node_row_id })
                .await;
        }
    }

    /// The staleness guard, notifications only: the two real races it closes
    /// are undo-advance disposing a just-born session whose first report is
    /// already in the mailbox (unlinked), and fail-and-redo replacing a node
    /// whose dying turn still reports in (the table holds that one; unknown
    /// rows and unlinked sessions drop here). Commands need no guard because
    /// the table already rejects them by state.
    fn note_is_stale(&self, state: &RunState, turn: &TurnFinished) -> bool {
        let stale_detail = match state.node(&turn.node_row_id) {
            None => Some("unknown node row"),
            Some(node) if node.session_id.is_none() => Some("session unlinked"),
            Some(_) => None,
        };
        let Some(detail) = stale_detail else {
            return false;
        };
        tracing::warn!(
            target: WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET,
            run_id = %self.run_id,
            node_row_id = %turn.node_row_id,
            detail,
            "stale workflow turn report dropped",
        );
        true
    }

    /// StartNode, the one two-step effect: render (or reuse) the envelope,
    /// create the durable session, link and stamp, start, dispatch the first
    /// prompt. The crash window between the row commit and the stamp is
    /// deliberate — the boot fence reads a running node with no session as
    /// exactly what it is. Any failure AFTER the session row exists
    /// compensates it (the house create-then-start pattern): a half-born
    /// session must not linger in the run workspace.
    async fn launch_node(&self, state: &mut RunState, node_row_id: &str) -> anyhow::Result<()> {
        let node = state
            .node(node_row_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("node row {node_row_id} not in run state"))?;
        let definition: WorkflowDefinition = serde_json::from_str(&state.run.definition_json)?;

        let envelope = match &node.rendered_envelope {
            Some(envelope) => envelope.clone(),
            None => {
                let envelope = self.render_node_envelope(state, &node)?;
                self.deps
                    .store
                    .store_rendered_envelope(&node.id, &envelope)?;
                envelope
            }
        };

        let (agent_kind, model_id, control_values) = launch_model(&node, &definition);

        let input = InternalSessionCreateInput {
            workspace_id: state.run.workspace_id.clone(),
            agent_kind: agent_kind.clone(),
            model_id,
            control_values,
            origin: OriginContext::system_local_runtime(),
            preselected_session_id: None,
        };
        let session = {
            let session_runtime = self.deps.session_runtime.clone();
            tokio::task::spawn_blocking(move || {
                session_runtime.create_persisted_internal_session(input)
            })
            .await
            .map_err(|join_error| anyhow::anyhow!("session create join failed: {join_error}"))?
            .map_err(|error| anyhow::anyhow!("session create failed: {error:?}"))?
        };

        if let Err(error) = self
            .link_start_and_dispatch(&node, &session, &envelope, &agent_kind)
            .await
        {
            // The session row exists but never became a working node session:
            // close and delete it before the failure feeds NodeLaunchFailed.
            // Best-effort — the rows already tell the truth, and the original
            // error must not be masked by a cleanup error.
            if let Err(cleanup_error) = self
                .deps
                .session_runtime
                .compensate_new_agent_session(&session.id)
                .await
            {
                tracing::warn!(
                    run_id = %self.run_id,
                    node_row_id = %node.id,
                    session_id = %session.id,
                    error = %cleanup_error,
                    "half-born workflow session compensation failed",
                );
            }
            return Err(error);
        }

        // Catch the cache up with the stamp.
        if let Some(fresh) = self.deps.store.load_run_state(&self.run_id)? {
            *state = fresh;
        }
        Ok(())
    }

    /// The fallible tail of a launch, split out so `launch_node` can
    /// compensate the freshly created session on ANY failure in here.
    async fn link_start_and_dispatch(
        &self,
        node: &WorkflowRunNodeRecord,
        session: &SessionRecord,
        envelope: &RenderedEnvelope,
        agent_kind: &str,
    ) -> anyhow::Result<()> {
        // Link and stamp BEFORE start: the launch extras resolve the envelope
        // through the sessions columns, and the extension matches turn reports
        // through them.
        let prompt_id = format!("wf2-{}", node.id);
        self.deps
            .session_store
            .link_workflow_columns(&session.id, &self.run_id, &node.id)?;
        self.title_node_session(node, &session.id);
        self.deps
            .store
            .stamp_session(&node.id, &session.id, Some(&prompt_id), Some(agent_kind))?;

        self.deps
            .session_runtime
            .start_persisted_session(session)
            .await
            .map_err(|error| anyhow::anyhow!("session start failed: {error:?}"))?;

        // Ruling D: the wrapped instruction blocks ride IN-BAND as leading
        // text blocks of the first prompt — identical for every harness — and
        // the node's first message is always the LAST block.
        let mut texts = envelope.instruction_blocks.clone();
        texts.push(envelope.first_message.clone());
        match self
            .deps
            .session_runtime
            .send_text_blocks_prompt_with_id(&session.id, texts, prompt_id)
            .await
        {
            Ok(_running_or_queued) => Ok(()),
            Err(TextPromptDispatchError::AcknowledgementLost) => {
                // The ambiguity rule: a lost acknowledgement is never a failure
                // claim — the turn may be running. The extension or the fence
                // resolves the row. No compensation: the session may be live.
                tracing::warn!(
                    run_id = %self.run_id,
                    node_row_id = %node.id,
                    session_id = %session.id,
                    "workflow envelope acknowledgement lost; leaving the node running",
                );
                Ok(())
            }
            Err(TextPromptDispatchError::Dispatch(error)) => {
                Err(anyhow::anyhow!("envelope dispatch failed: {error:?}"))
            }
        }
    }

    /// Name the node's session after the node, before the stamp that first
    /// makes that session findable from the projection: a client raising a tab
    /// for it never has to show the harness's own guess (which echoes the
    /// first message, preamble and all) or the bare agent name.
    ///
    /// Written unconditionally, and it stays: the two writers that can follow
    /// — the harness info update and the prompt-derived fallback — are both
    /// if-absent, so only a deliberate rename replaces it.
    ///
    /// Cosmetic, so a failure is logged and the launch continues: an untitled
    /// node session is still a working one.
    fn title_node_session(&self, node: &WorkflowRunNodeRecord, session_id: &str) {
        let title = node_session_title(node.chain_index, &node.title);
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(error) = self
            .deps
            .session_store
            .update_title(session_id, &title, &now)
        {
            tracing::warn!(
                run_id = %self.run_id,
                node_row_id = %node.id,
                session_id = %session_id,
                error = %error,
                "workflow node session title write failed; leaving the session untitled",
            );
        }
    }

    /// Stamp Ruling J's undo-window close and refresh the cache so the very
    /// next decision sees it. Failures keep the stale cache and log — the
    /// report itself must still be processed.
    fn stamp_first_turn(&self, state: &mut RunState, node_row_id: &str) {
        if let Err(error) = self.deps.store.note_first_turn_finished(node_row_id) {
            tracing::error!(
                run_id = %self.run_id,
                node_row_id = %node_row_id,
                error = %error,
                "undo-window stamp failed; proceeding on the cached state",
            );
            return;
        }
        match self.deps.store.load_run_state(&self.run_id) {
            Ok(Some(fresh)) => *state = fresh,
            Ok(None) => {}
            Err(error) => tracing::error!(
                run_id = %self.run_id,
                error = %error,
                "post-stamp state reload failed; proceeding on the cached state",
            ),
        }
    }

    fn render_node_envelope(
        &self,
        state: &RunState,
        node: &WorkflowRunNodeRecord,
    ) -> anyhow::Result<RenderedEnvelope> {
        let workspace = self
            .deps
            .workspace_store
            .find_by_id(&state.run.workspace_id)?
            .ok_or_else(|| {
                anyhow::anyhow!("workspace {} not found for render", state.run.workspace_id)
            })?;
        let arguments: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&state.run.arguments_json)?;
        let docs = self.deps.store.list_docs(&self.run_id)?;
        let context_dir = Path::new(&workspace.path).join(run_context_dir_relative(&self.run_id));
        render_envelope(&RenderInputs {
            node_type: node.node_type,
            prompt: &node.prompt,
            // Ruling E: definition prompts were validated before the snapshot
            // froze and render strict; redo-edited and ad hoc prompts are
            // user-typed and render lenient (unresolvable refs pass through
            // as the literal text the user typed).
            mode: if node.kind == WorkflowNodeKind::Defined {
                ResolveMode::Strict
            } else {
                ResolveMode::Lenient
            },
            arguments: &arguments,
            docs: &docs,
            context_dir: &context_dir,
        })
        .map_err(|error| anyhow::anyhow!("envelope render failed: {error}"))
    }

    /// Undo-advance and redo-from-running: close and dismiss the session,
    /// then unlink its workflow columns. Disposal is soft — nothing is
    /// destroyed that anyone could miss — and best-effort: the rows already
    /// tell the truth, so a failed dismiss only leaves a closable session
    /// behind.
    async fn dispose_session(&self, session_id: &str) {
        if let Err(error) = self
            .deps
            .session_runtime
            .dismiss_live_session(session_id)
            .await
        {
            tracing::warn!(
                run_id = %self.run_id,
                session_id = %session_id,
                error = ?error,
                "undo-advance session dismiss failed",
            );
        }
        if let Err(error) = self.deps.session_store.clear_workflow_columns(session_id) {
            tracing::warn!(
                run_id = %self.run_id,
                session_id = %session_id,
                error = %error,
                "undo-advance session unlink failed",
            );
        }
    }
}

/// Launch config precedence: the node row's own pick wins (adhoc, and
/// adhoc-redo inheritance per Ruling K.1); a defined/replacement row resolves
/// through the frozen definition by its `definition_node_id`; otherwise the
/// boring app default.
pub(super) fn launch_model(
    node: &WorkflowRunNodeRecord,
    definition: &WorkflowDefinition,
) -> (
    String,
    Option<String>,
    std::collections::BTreeMap<String, String>,
) {
    let model = node.model.clone().or_else(|| {
        node.definition_node_id
            .as_deref()
            .and_then(|id| definition.nodes.iter().find(|node| node.id == id))
            .and_then(|node| node.model.clone())
    });
    match model {
        Some(model) => (model.agent_kind, model.model_id, model.control_values),
        None => (
            DEFAULT_WORKFLOW_AGENT_KIND.to_string(),
            None,
            Default::default(),
        ),
    }
}
