//! The pure transition function: the ADR's transition table, verbatim, as
//! `next(state, event) -> Decision`. No IO, no clocks, no ids minted — the
//! store applies a `Transition` in one SQLite transaction (stamping times and
//! minting new row ids), and only after that commit does the live engine
//! perform the side effect the transition names. Anything the table does not
//! allow is `Decision::Illegal`, which the API maps to 409
//! `WORKFLOW_TRANSITION_ILLEGAL`. Notifications that no longer apply (stale
//! turn reports racing undo or redo) come back as `Decision::Hold`.

use super::model::{
    RenderedEnvelope, WorkflowInterruptionCode, WorkflowNodeFailureCode, WorkflowNodeKind,
    WorkflowNodeStatus, WorkflowNodeType, WorkflowRunNodeRecord, WorkflowRunRecord,
    WorkflowRunStatus,
};

/// The in-memory image of one run: a cache of the rows, loaded once per actor
/// and updated only after a commit.
#[derive(Debug, Clone)]
pub struct RunState {
    pub run: WorkflowRunRecord,
    pub nodes: Vec<WorkflowRunNodeRecord>,
}

impl RunState {
    pub fn run_is_terminal(&self) -> bool {
        self.run.status.is_terminal()
    }

    pub fn node(&self, node_row_id: &str) -> Option<&WorkflowRunNodeRecord> {
        self.nodes.iter().find(|node| node.id == node_row_id)
    }

    /// A chain row is superseded once another row replaces it.
    fn is_superseded(&self, node_row_id: &str) -> bool {
        self.nodes
            .iter()
            .any(|node| node.replaces_node_row_id.as_deref() == Some(node_row_id))
    }

    /// The effective chain: non-adhoc rows that are not superseded, in chain
    /// order. Replacements inherit their predecessor's chain_index, so this is
    /// always one row per position.
    pub fn effective_chain(&self) -> Vec<&WorkflowRunNodeRecord> {
        let mut chain: Vec<&WorkflowRunNodeRecord> = self
            .nodes
            .iter()
            .filter(|node| node.kind != WorkflowNodeKind::Adhoc && !self.is_superseded(&node.id))
            .collect();
        chain.sort_by_key(|node| node.chain_index.unwrap_or(i64::MAX));
        chain
    }

    pub fn current_node(&self) -> Option<&WorkflowRunNodeRecord> {
        self.run
            .current_node_row_id
            .as_deref()
            .and_then(|id| self.node(id))
    }

    fn next_on_chain(&self, node_row_id: &str) -> Option<&WorkflowRunNodeRecord> {
        let chain = self.effective_chain();
        let position = chain.iter().position(|node| node.id == node_row_id)?;
        chain.get(position + 1).copied()
    }

    fn previous_on_chain(&self, node_row_id: &str) -> Option<&WorkflowRunNodeRecord> {
        let chain = self.effective_chain();
        let position = chain.iter().position(|node| node.id == node_row_id)?;
        position.checked_sub(1).and_then(|i| chain.get(i)).copied()
    }
}

/// Everything that can wake the state machine. Commands come from the API
/// through the manager; turn reports come from the session extension; the
/// fence and launch failures are the engine's own events.
#[derive(Debug, Clone)]
pub enum WorkflowEvent {
    Command(WorkflowCommand),
    TurnFinished(TurnFinished),
    BootFence { code: WorkflowInterruptionCode },
    NodeLaunchFailed { node_row_id: String },
}

#[derive(Debug, Clone)]
pub enum WorkflowCommand {
    ApproveGate {
        node_row_id: String,
    },
    FailAndRedo {
        node_row_id: String,
        prompt: Option<String>,
        /// A per-row model override for the replacement. `None` keeps the
        /// row's inherited resolution (the frozen definition for a chain
        /// row, the launch pick for an adhoc row); `Some` outranks it for
        /// this replacement only and never rewrites the sealed snapshot.
        model: Option<super::definition::NodeModel>,
    },
    FlipType {
        node_row_id: String,
        node_type: WorkflowNodeType,
    },
    UndoAdvance,
    Resume,
    AddAdhocNode {
        anchor_node_row_id: String,
        prompt: String,
        model: Option<super::definition::NodeModel>,
    },
    Cancel,
}

impl WorkflowCommand {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ApproveGate { .. } => "approve_gate",
            Self::FailAndRedo { .. } => "fail_and_redo",
            Self::FlipType { .. } => "flip_type",
            Self::UndoAdvance => "undo_advance",
            Self::Resume => "resume",
            Self::AddAdhocNode { .. } => "add_adhoc_node",
            Self::Cancel => "cancel",
        }
    }
}

/// The extension's value snapshot of one finished turn: node identity, the
/// mapped stop reason, and the pending queue's emptiness at the finish
/// instant. Never a live reference into the session world.
#[derive(Debug, Clone)]
pub struct TurnFinished {
    pub node_row_id: String,
    pub stop_reason: TurnStopReason,
    pub queue_empty: bool,
}

/// The ruled stop-reason mapping: only a clean end of turn with real activity
/// completes a node. The session actor already reclassifies zero-activity ends
/// as `EmptyTurn`; harness caps (MaxTokens/MaxTurnRequests) get no dedicated
/// handling and arrive as `HarnessCap` into the same generic failure path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnStopReason {
    CleanEndTurn,
    Refusal,
    EmptyTurn,
    Error,
    HarnessCap,
    Cancelled,
    /// A non-terminal actor unload (app shutdown, runtime eviction) cancelled
    /// the turn — not the user. Parks with `app_shutdown`, never `user_cancel`.
    ForcedUnload,
}

impl TurnStopReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CleanEndTurn => "clean_end_turn",
            Self::Refusal => "refusal",
            Self::EmptyTurn => "empty_turn",
            Self::Error => "error",
            Self::HarnessCap => "harness_cap",
            Self::Cancelled => "cancelled",
            Self::ForcedUnload => "forced_unload",
        }
    }

    fn failure_code(&self) -> Option<WorkflowNodeFailureCode> {
        match self {
            Self::Refusal => Some(WorkflowNodeFailureCode::Refusal),
            Self::EmptyTurn => Some(WorkflowNodeFailureCode::EmptyTurn),
            Self::Error => Some(WorkflowNodeFailureCode::TurnError),
            Self::HarnessCap => Some(WorkflowNodeFailureCode::HarnessCap),
            Self::CleanEndTurn | Self::Cancelled | Self::ForcedUnload => None,
        }
    }
}

/// A new row the transition creates in the same transaction (replacement or
/// adhoc). The store mints its id.
#[derive(Debug, Clone, PartialEq)]
pub struct NewNodeSpec {
    pub definition_node_id: Option<String>,
    pub kind: WorkflowNodeKind,
    pub node_type: WorkflowNodeType,
    pub replaces_node_row_id: Option<String>,
    pub anchor_node_row_id: Option<String>,
    pub chain_index: Option<i64>,
    pub title: String,
    pub prompt: String,
    pub rendered_envelope: Option<RenderedEnvelope>,
    pub model: Option<super::definition::NodeModel>,
}

/// What one applied turn report does to an adhoc row. Adhoc nodes never
/// advance or block the run; their turn reports update only their own row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdhocOutcome {
    Completed,
    Failed(WorkflowNodeFailureCode),
    NeedsAttention,
}

/// One persisted transition: each variant is one row of the ADR table (or its
/// engine-internal twin), applied as one SQLite transaction.
#[derive(Debug, Clone, PartialEq)]
pub enum Transition {
    /// Agent turn done / gate approved / gate flipped to agent, with a next
    /// node to start. `completed_node_type` persists the flip when a waiting
    /// gate advanced by being flipped to agent (the row must not keep reading
    /// human_in_loop after the flip).
    AdvanceToNext {
        completed_node_row_id: String,
        next_node_row_id: String,
        completed_node_type: Option<WorkflowNodeType>,
    },
    /// Same, but the completed node was last on the chain: the run completes.
    CompleteRun {
        completed_node_row_id: String,
        completed_node_type: Option<WorkflowNodeType>,
    },
    /// A human_in_loop turn ended cleanly: the gate renders.
    GateNode { node_row_id: String },
    /// Refusal / empty turn / error / launch failure: node failed, run failed.
    FailNode {
        node_row_id: String,
        code: WorkflowNodeFailureCode,
    },
    /// User cancel mid-run: node needs_attention, run interrupted.
    InterruptNode {
        node_row_id: String,
        code: WorkflowInterruptionCode,
    },
    /// Row-only type flip; its entire effect is where the node's next
    /// TurnFinished lands in the table.
    FlipNodeType {
        node_row_id: String,
        node_type: WorkflowNodeType,
    },
    /// Fail-and-redo: the old row stays failed beside its replacement.
    /// `disposed_session_id` is set when the redo hit a RUNNING chain node
    /// (Ruling L): its live session is disposed before the replacement starts.
    Redo {
        failed_node_row_id: String,
        replacement: NewNodeSpec,
        disposed_session_id: Option<String>,
    },
    /// Undo an advance: the just-started node returns to pending unlinked, the
    /// completed node parks as a retroactive gate.
    UndoAdvance {
        undone_node_row_id: String,
        gate_node_row_id: String,
        disposed_session_id: Option<String>,
    },
    /// Boot fence: EVERY running node row (chain or adhoc) parks
    /// needs_attention; the run parks interrupted only if it was itself
    /// running. An awaiting_human run keeps its status so the gate and its
    /// pending approval survive the restart (Ruling K).
    Fence {
        node_row_ids: Vec<String>,
        interrupt_run: bool,
        code: WorkflowInterruptionCode,
    },
    /// Resume an interrupted run: the current node runs again in a fresh
    /// session, same workspace, envelope resent.
    ResumeNode { node_row_id: String },
    /// A new adhoc row, anchored to the chain, running; never advances.
    AddAdhoc { adhoc: NewNodeSpec },
    /// An adhoc node's own turn report: its row only, the run untouched.
    AdhocTurn {
        node_row_id: String,
        outcome: AdhocOutcome,
    },
    /// User-initiated cancel: the run and its current node both go terminal.
    /// `disposed_session_ids` collects EVERY running row's live session —
    /// the chain node (Ruling L's condition: only when it was RUNNING, since
    /// pause states hold no live turn to kill) plus any concurrently running
    /// adhoc row. Unlike FailNode/CompleteRun, an adhoc row cannot be trusted
    /// to self-resolve via its own turn report once the run is terminal and
    /// the workspace policy releases: a wedged adhoc turn would otherwise
    /// stay live forever. Mirrors `on_boot_fence`'s "every running row" scan.
    Cancel {
        node_row_id: String,
        disposed_session_ids: Vec<String>,
    },
}

impl Transition {
    /// The telemetry `event` field on `anyharness.workflow.transition`.
    pub fn label(&self) -> &'static str {
        match self {
            Self::AdvanceToNext { .. } => "advance_to_next",
            Self::CompleteRun { .. } => "complete_run",
            Self::GateNode { .. } => "gate_node",
            Self::FailNode { .. } => "fail_node",
            Self::InterruptNode { .. } => "interrupt_node",
            Self::FlipNodeType { .. } => "flip_node_type",
            Self::Redo { .. } => "fail_and_redo",
            Self::UndoAdvance { .. } => "undo_advance",
            Self::Fence { .. } => "boot_fence",
            Self::ResumeNode { .. } => "resume",
            Self::AddAdhoc { .. } => "add_adhoc_node",
            Self::AdhocTurn { .. } => "adhoc_turn",
            Self::Cancel { .. } => "cancel",
        }
    }
}

/// Why an event was refused; travels back as the 409 body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IllegalTransition {
    pub command: String,
    pub node_state: Option<String>,
    pub run_state: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Transition(Transition),
    Hold,
    Illegal(IllegalTransition),
}

fn illegal(
    state: &RunState,
    command: &str,
    node: Option<&WorkflowRunNodeRecord>,
    detail: impl Into<String>,
) -> Decision {
    Decision::Illegal(IllegalTransition {
        command: command.to_string(),
        node_state: node.map(|node| node.status.as_str().to_string()),
        run_state: state.run.status.as_str().to_string(),
        detail: detail.into(),
    })
}

/// The transition table. Pure: same state and event, same decision.
pub fn next(state: &RunState, event: &WorkflowEvent) -> Decision {
    match event {
        WorkflowEvent::TurnFinished(turn) => on_turn_finished(state, turn),
        WorkflowEvent::Command(command) => on_command(state, command),
        WorkflowEvent::BootFence { code } => on_boot_fence(state, *code),
        WorkflowEvent::NodeLaunchFailed { node_row_id } => {
            on_node_launch_failed(state, node_row_id)
        }
    }
}

fn on_turn_finished(state: &RunState, turn: &TurnFinished) -> Decision {
    let Some(node) = state.node(&turn.node_row_id) else {
        // Unknown row: a report for something this run never owned. Drop.
        return Decision::Hold;
    };

    // Adhoc rows report only to themselves: never advance, never block.
    if node.kind == WorkflowNodeKind::Adhoc {
        if node.status != WorkflowNodeStatus::Running {
            return Decision::Hold;
        }
        let outcome = match turn.stop_reason {
            TurnStopReason::CleanEndTurn if turn.queue_empty => AdhocOutcome::Completed,
            TurnStopReason::CleanEndTurn => return Decision::Hold,
            TurnStopReason::Cancelled | TurnStopReason::ForcedUnload => {
                AdhocOutcome::NeedsAttention
            }
            reason => AdhocOutcome::Failed(
                reason
                    .failure_code()
                    .unwrap_or(WorkflowNodeFailureCode::TurnError),
            ),
        };
        return Decision::Transition(Transition::AdhocTurn {
            node_row_id: node.id.clone(),
            outcome,
        });
    }

    // Chain rows: only the run's current running node may report. Everything
    // else is a stale report (completed nodes stay chattable; their further
    // turns never affect orchestration).
    if state.run.status != WorkflowRunStatus::Running
        || state.run.current_node_row_id.as_deref() != Some(node.id.as_str())
        || node.status != WorkflowNodeStatus::Running
    {
        return Decision::Hold;
    }

    match turn.stop_reason {
        TurnStopReason::CleanEndTurn if !turn.queue_empty => {
            // A queued interjection holds the node open: the queued turn runs
            // and completion waits for a turn that ends with an empty queue.
            Decision::Hold
        }
        TurnStopReason::CleanEndTurn => match node.node_type {
            WorkflowNodeType::Agent => advance_or_complete(state, node, None),
            WorkflowNodeType::HumanInLoop => Decision::Transition(Transition::GateNode {
                node_row_id: node.id.clone(),
            }),
        },
        TurnStopReason::Cancelled => Decision::Transition(Transition::InterruptNode {
            node_row_id: node.id.clone(),
            code: WorkflowInterruptionCode::UserCancel,
        }),
        TurnStopReason::ForcedUnload => Decision::Transition(Transition::InterruptNode {
            node_row_id: node.id.clone(),
            code: WorkflowInterruptionCode::AppShutdown,
        }),
        reason => Decision::Transition(Transition::FailNode {
            node_row_id: node.id.clone(),
            code: reason
                .failure_code()
                .unwrap_or(WorkflowNodeFailureCode::TurnError),
        }),
    }
}

fn advance_or_complete(
    state: &RunState,
    node: &WorkflowRunNodeRecord,
    completed_node_type: Option<WorkflowNodeType>,
) -> Decision {
    match state.next_on_chain(&node.id) {
        Some(next_node) => Decision::Transition(Transition::AdvanceToNext {
            completed_node_row_id: node.id.clone(),
            next_node_row_id: next_node.id.clone(),
            completed_node_type,
        }),
        None => Decision::Transition(Transition::CompleteRun {
            completed_node_row_id: node.id.clone(),
            completed_node_type,
        }),
    }
}

fn on_command(state: &RunState, command: &WorkflowCommand) -> Decision {
    if state.run_is_terminal() {
        // Terminal runs accept only fail-and-redo (a failed run's recovery).
        if !matches!(command, WorkflowCommand::FailAndRedo { .. }) {
            return illegal(state, command.as_str(), None, "the run is terminal");
        }
    }
    match command {
        WorkflowCommand::ApproveGate { node_row_id } => {
            let Some(node) = state.node(node_row_id) else {
                return illegal(state, command.as_str(), None, "unknown node row");
            };
            if node.status != WorkflowNodeStatus::AwaitingHuman
                || state.run.current_node_row_id.as_deref() != Some(node.id.as_str())
            {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "only the waiting gate can be approved",
                );
            }
            advance_or_complete(state, node, None)
        }
        WorkflowCommand::FlipType {
            node_row_id,
            node_type,
        } => {
            let Some(node) = state.node(node_row_id) else {
                return illegal(state, command.as_str(), None, "unknown node row");
            };
            if node.kind == WorkflowNodeKind::Adhoc {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "adhoc nodes have no gate semantics to flip",
                );
            }
            if node.node_type == *node_type {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "the node already has that type",
                );
            }
            match node.status {
                // Flipping the waiting gate to agent advances immediately: the
                // finished turn counts as done, and the flip persists on the
                // completed row so a later undo re-parks it as an agent node.
                WorkflowNodeStatus::AwaitingHuman
                    if *node_type == WorkflowNodeType::Agent
                        && state.run.current_node_row_id.as_deref() == Some(node.id.as_str()) =>
                {
                    advance_or_complete(state, node, Some(*node_type))
                }
                // A running agent node flipped to human_in_loop pauses for the
                // human when its turn ends; an upcoming (pending) node flips
                // freely in both directions. Row-only either way.
                WorkflowNodeStatus::Running | WorkflowNodeStatus::Pending => {
                    Decision::Transition(Transition::FlipNodeType {
                        node_row_id: node.id.clone(),
                        node_type: *node_type,
                    })
                }
                _ => illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "type flips apply to the waiting gate, a running node, or an upcoming node",
                ),
            }
        }
        WorkflowCommand::FailAndRedo {
            node_row_id,
            prompt,
            model,
        } => {
            let Some(node) = state.node(node_row_id) else {
                return illegal(state, command.as_str(), None, "unknown node row");
            };
            if state.is_superseded(&node.id) {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "the node was already replaced",
                );
            }
            let adhoc = node.kind == WorkflowNodeKind::Adhoc;
            // Adhoc rows never gate, so awaiting_human is not a legal pause
            // for them; the fence and turn failures are their recovery entry
            // points (Ruling K). A RUNNING chain node may also be redone
            // (Ruling L) — the liveness escape for a wedged node whose turn
            // will never end; its live session is disposed in the same
            // committed step. Adhoc rows keep the pause-only rule (K.1).
            let legal_pause = if adhoc {
                matches!(
                    node.status,
                    WorkflowNodeStatus::Failed | WorkflowNodeStatus::NeedsAttention
                )
            } else {
                matches!(
                    node.status,
                    WorkflowNodeStatus::Failed
                        | WorkflowNodeStatus::NeedsAttention
                        | WorkflowNodeStatus::AwaitingHuman
                        | WorkflowNodeStatus::Running
                )
            };
            if !legal_pause {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "fail-and-redo applies at a pause (failed, needs_attention, awaiting_human) \
                     or to a running chain node",
                );
            }
            let prompt_edited = prompt.is_some();
            let replacement_prompt = prompt.clone().unwrap_or_else(|| node.prompt.clone());
            Decision::Transition(Transition::Redo {
                failed_node_row_id: node.id.clone(),
                replacement: NewNodeSpec {
                    definition_node_id: node.definition_node_id.clone(),
                    // An adhoc row's replacement is also adhoc, anchored the
                    // same; a chain row's replacement takes its chain slot.
                    kind: if adhoc {
                        WorkflowNodeKind::Adhoc
                    } else {
                        WorkflowNodeKind::Replacement
                    },
                    node_type: node.node_type,
                    replaces_node_row_id: Some(node.id.clone()),
                    anchor_node_row_id: node.anchor_node_row_id.clone(),
                    chain_index: node.chain_index,
                    title: node.title.clone(),
                    prompt: replacement_prompt,
                    // An edited prompt invalidates the stored envelope; the
                    // engine re-renders before launch (same rendering path).
                    rendered_envelope: if prompt_edited {
                        None
                    } else {
                        node.rendered_envelope.clone()
                    },
                    // An explicit override outranks the inherited resolution
                    // for this replacement only — the frozen definition is
                    // never rewritten. Without one, an adhoc redo keeps its
                    // launch pick and a chain replacement resolves through the
                    // frozen definition it inherits.
                    model: match model {
                        Some(model) => Some(model.clone()),
                        None if adhoc => node.model.clone(),
                        None => None,
                    },
                },
                // Ruling L: redo of a mid-flight node disposes the session it
                // is taking over from; pause states hold no live turn to kill.
                disposed_session_id: if node.status == WorkflowNodeStatus::Running {
                    node.session_id.clone()
                } else {
                    None
                },
            })
        }
        WorkflowCommand::UndoAdvance => {
            let Some(node) = state.current_node() else {
                return illegal(state, command.as_str(), None, "no current node to undo");
            };
            if state.run.status != WorkflowRunStatus::Running
                || node.status != WorkflowNodeStatus::Running
                || node.kind == WorkflowNodeKind::Adhoc
            {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "undo applies to the node an advance just started",
                );
            }
            if node.first_turn_finished_at.is_some() {
                // Ruling J: undo exists to close-dismiss-unlink a JUST-started
                // node. Once its session finished a turn, undo is a 409.
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "the started node already finished a turn; the undo window is closed",
                );
            }
            let Some(previous) = state.previous_on_chain(&node.id) else {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "the first node has no advance to undo",
                );
            };
            if previous.status != WorkflowNodeStatus::Completed {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "the previous node did not complete by an advance",
                );
            }
            Decision::Transition(Transition::UndoAdvance {
                undone_node_row_id: node.id.clone(),
                gate_node_row_id: previous.id.clone(),
                disposed_session_id: node.session_id.clone(),
            })
        }
        WorkflowCommand::Resume => {
            if state.run.status != WorkflowRunStatus::Interrupted {
                return illegal(
                    state,
                    command.as_str(),
                    None,
                    "only an interrupted run can resume",
                );
            }
            let Some(node) = state.current_node() else {
                return illegal(state, command.as_str(), None, "no current node to resume");
            };
            if node.status != WorkflowNodeStatus::NeedsAttention {
                return illegal(
                    state,
                    command.as_str(),
                    Some(node),
                    "resume restarts the fenced current node",
                );
            }
            Decision::Transition(Transition::ResumeNode {
                node_row_id: node.id.clone(),
            })
        }
        WorkflowCommand::AddAdhocNode {
            anchor_node_row_id,
            prompt,
            model,
        } => {
            let Some(anchor) = state.node(anchor_node_row_id) else {
                return illegal(state, command.as_str(), None, "unknown anchor node row");
            };
            if anchor.kind == WorkflowNodeKind::Adhoc {
                return illegal(
                    state,
                    command.as_str(),
                    Some(anchor),
                    "adhoc nodes anchor to the chain, not to each other",
                );
            }
            if prompt.trim().is_empty() {
                return illegal(
                    state,
                    command.as_str(),
                    Some(anchor),
                    "an adhoc node needs a prompt",
                );
            }
            Decision::Transition(Transition::AddAdhoc {
                adhoc: NewNodeSpec {
                    definition_node_id: None,
                    kind: WorkflowNodeKind::Adhoc,
                    node_type: WorkflowNodeType::Agent,
                    replaces_node_row_id: None,
                    anchor_node_row_id: Some(anchor.id.clone()),
                    chain_index: anchor.chain_index,
                    title: adhoc_title(prompt),
                    prompt: prompt.clone(),
                    rendered_envelope: None,
                    model: model.clone(),
                },
            })
        }
        WorkflowCommand::Cancel => {
            // The terminal-run gate above already rejects Cancel once the run
            // is terminal, so this arm only ever sees running / awaiting_human
            // / interrupted — exactly the legal set the QA finding needs.
            let Some(node) = state.current_node() else {
                return illegal(state, command.as_str(), None, "no current node to cancel");
            };
            // Every running row's live session, chain or adhoc — same scan as
            // `on_boot_fence` — so a running adhoc row is not left with a live
            // agent burning tokens under a now-terminal, dispose-released run.
            let disposed_session_ids: Vec<String> = state
                .nodes
                .iter()
                .filter(|other| other.status == WorkflowNodeStatus::Running)
                .filter_map(|other| other.session_id.clone())
                .collect();
            Decision::Transition(Transition::Cancel {
                node_row_id: node.id.clone(),
                disposed_session_ids,
            })
        }
    }
}

fn adhoc_title(prompt: &str) -> String {
    let first_line = prompt.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return "Ad hoc".to_string();
    }
    let mut title: String = first_line.chars().take(60).collect();
    if first_line.chars().count() > 60 {
        title.push('…');
    }
    title
}

fn on_boot_fence(state: &RunState, code: WorkflowInterruptionCode) -> Decision {
    // Ruling K: fence EVERY running node row — chain or adhoc — because any of
    // them holds a dead session after a restart. The run itself parks
    // interrupted only if it claimed live execution; an awaiting_human run
    // keeps its status so the gate's pending approval survives, and terminal
    // or already-interrupted runs keep theirs (idempotent).
    let node_row_ids: Vec<String> = state
        .nodes
        .iter()
        .filter(|node| node.status == WorkflowNodeStatus::Running)
        .map(|node| node.id.clone())
        .collect();
    let interrupt_run = state.run.status == WorkflowRunStatus::Running;
    if node_row_ids.is_empty() && !interrupt_run {
        return Decision::Hold;
    }
    Decision::Transition(Transition::Fence {
        node_row_ids,
        interrupt_run,
        code,
    })
}

fn on_node_launch_failed(state: &RunState, node_row_id: &str) -> Decision {
    let Some(node) = state.node(node_row_id) else {
        return Decision::Hold;
    };
    if node.status != WorkflowNodeStatus::Running {
        return Decision::Hold;
    }
    if node.kind == WorkflowNodeKind::Adhoc {
        return Decision::Transition(Transition::AdhocTurn {
            node_row_id: node.id.clone(),
            outcome: AdhocOutcome::Failed(WorkflowNodeFailureCode::NodeLaunchFailed),
        });
    }
    Decision::Transition(Transition::FailNode {
        node_row_id: node.id.clone(),
        code: WorkflowNodeFailureCode::NodeLaunchFailed,
    })
}
