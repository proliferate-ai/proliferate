//! The live [`WorkflowStepExecutor`] implementation: it drives real sessions,
//! goals, shells, PRs, and notifications. Sessions are slot-keyed (B7): each
//! agent slot owns exactly one session for the run's lifetime (harness is fixed
//! per slot — there is no harness-switch machinery), and turn/goal completion is
//! awaited off the live session's broadcast stream.
//!
//! This file owns only the [`WorkflowStepExecutorImpl`] struct, its
//! construction, and the [`WorkflowStepExecutor`] trait impl's dispatch match
//! (WS0B-R decomposition); the step-kind bodies live in sibling modules:
//! [`super::agent_turn`] (session ensure/create/bind, prompt injection, turn
//! waiting), [`super::emit`] (`agent.emit`), [`super::effects`] (`shell.run` /
//! `scm.open_pr` orchestration), [`super::observation`] (goal-progress report
//! plumbing), [`super::receipts`] (the `required_invocation` gate), and
//! [`super::parallel`] (run/lane worktree minting, crash-resume, merge-back).

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::agent_turn::CurrentSession;
use super::turn::InjectionMeta;
use super::commands;
use super::exec_policy::WorkflowOwnedSessions;
use super::gateway::{fire_run_ping, RunPingSink, WorkflowGatewaySessions};
use crate::domains::goals::runtime::GoalRuntime;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::workflows::engine::{StepExecContext, StepOutcome, WorkflowStepExecutor};
use crate::domains::workflows::plan::{
    BranchStep, BranchTarget, Isolation, PlanGateway, PlanStep, SessionSpec, StepKind,
};
use crate::domains::workflows::plan::worktree_scope;
use crate::domains::workflows::service::WorkflowService;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::sessions::LiveSessionManager;

/// The shared, run-independent dependencies the executor needs.
pub struct WorkflowExecDeps {
    pub session_runtime: Arc<SessionRuntime>,
    pub goal_runtime: Arc<GoalRuntime>,
    pub session_service: Arc<SessionService>,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub workflow_service: Arc<WorkflowService>,
    pub acp_manager: LiveSessionManager,
    /// The always-bypass safety net (goals-and-workflows-v1 §3.3): sessions
    /// the executor opens are marked here so the inbound permission advisor
    /// auto-approves for a harness that lacks a native bypass mode. Shared with
    /// the live-session wiring's [`WorkflowAutoApproveAdvisor`].
    ///
    /// [`WorkflowAutoApproveAdvisor`]: super::exec_policy::WorkflowAutoApproveAdvisor
    pub workflow_owned_sessions: Arc<WorkflowOwnedSessions>,
    /// Per-run gateway MCP servers, keyed by session id. The executor registers
    /// its workflow-owned session's server here before launch; the launch
    /// extension reads it (§6.4/OPEN-3(a)).
    pub workflow_gateway_sessions: Arc<WorkflowGatewaySessions>,
    /// Fire-and-forget sink for the per-run completion ping (§3.7/L16).
    pub run_ping_sink: Arc<dyn RunPingSink>,
}

/// One executor per run. Sessions are slot-keyed (B7): `current` maps each
/// agent slot to the one live session it owns; `models` tracks the effective
/// model per slot (seeded from the plan's `sessions[slot].model`, mutated by
/// `agent.config` steps — which are model-only, A3). All maps are hydrated from
/// the run record on resume.
pub struct WorkflowStepExecutorImpl {
    pub(super) deps: Arc<WorkflowExecDeps>,
    pub(super) run_id: String,
    /// The run's PINNED workspace (data-contract §3 target). Under
    /// [`Isolation::Workspace`] the run executes here directly; under
    /// [`Isolation::Worktree`] this is the checkout the per-run worktree is
    /// minted from.
    pub(super) workspace_id: String,
    /// Run isolation posture (wave 2b): plan-level, resolved once into the
    /// memoized `effective_workspace` below.
    pub(super) isolation: Isolation,
    /// The effective workspace every session/shell/emit of this run resolves to.
    /// Memoized: under `Workspace` isolation it is `workspace_id`; under
    /// `Worktree` isolation it is the id of the per-run git worktree, minted
    /// lazily on first use (and once only, so all the run's slots share it — B7
    /// / one worktree per RUN in v1). `None` until first resolution; recovered
    /// on crash-resume from a persisted session's workspace — or, when the run
    /// persisted no session yet (a shell/PR-only prefix), by ADOPTING the run's
    /// own worktree record — in [`WorkflowStepExecutorImpl::hydrate_from_run`].
    ///
    /// A [`tokio::sync::Mutex`] (not `std`): the memo is held across the
    /// `spawn_blocking` mint await, so it must be an async-aware lock (holding a
    /// `std` guard across `.await` would block the runtime worker).
    ///
    /// This is the RUN-LEVEL worktree (scope [`crate::domains::workflows::plan::NO_LANE`])
    /// — flat runs and any out-of-group step. Steps inside a parallel lane
    /// resolve to a per-lane worktree instead (D-031c), memoized in
    /// `lane_workspaces` below.
    pub(super) effective_workspace: tokio::sync::Mutex<Option<String>>,
    /// Per-LANE effective workspaces (D-031c), keyed by lane name (the step's
    /// worktree scope). Under [`Isolation::Worktree`] each parallel lane mints
    /// its own worktree (branch `workflow-run/<run_id>/<lane>`, path
    /// `wf-run-<run_id>-<lane>`) so write-parallel lanes never share a checkout.
    /// Empty for flat runs and under [`Isolation::Workspace`] (everything shares
    /// the pinned checkout). Recovered on resume in `hydrate_from_run`.
    pub(super) lane_workspaces: tokio::sync::Mutex<HashMap<String, String>>,
    /// Per-slot session provisioning, straight from the resolved plan.
    pub(super) sessions: BTreeMap<String, SessionSpec>,
    /// slot -> the live session opened for it.
    pub(super) current: Mutex<HashMap<String, CurrentSession>>,
    /// slot -> effective model (base `sessions[slot].model`, folded by
    /// `agent.config`).
    pub(super) models: Mutex<HashMap<String, Option<String>>>,
    /// The plan's per-run gateway block (§6.4/§3.7). Drives both the
    /// session-launch MCP injection and the completion ping. Cloned from the
    /// plan at construction; recomputed identically on crash-resume (the plan
    /// is re-parsed to build the executor).
    pub(super) gateway: Option<PlanGateway>,
}

impl WorkflowStepExecutorImpl {
    pub fn new(
        deps: Arc<WorkflowExecDeps>,
        run_id: String,
        workspace_id: String,
        isolation: Isolation,
        sessions: BTreeMap<String, SessionSpec>,
        gateway: Option<PlanGateway>,
    ) -> Self {
        let models = sessions
            .iter()
            .map(|(slot, spec)| (slot.clone(), spec.model.clone()))
            .collect();
        Self {
            deps,
            run_id,
            workspace_id,
            isolation,
            effective_workspace: tokio::sync::Mutex::new(None),
            lane_workspaces: tokio::sync::Mutex::new(HashMap::new()),
            sessions,
            current: Mutex::new(HashMap::new()),
            models: Mutex::new(models),
            gateway,
        }
    }

    /// `branch` (C11/D3): the `on` template was late-bound to a value by the
    /// resolver, so it arrives as a literal here. Match it against the cases and
    /// route: `continue` advances normally (`Completed`), `end` ends the run
    /// (`EndRun`, E5). An unmatched value fails `branch_unmatched` (on_fail
    /// applies).
    fn run_branch(&self, step: &BranchStep) -> StepOutcome {
        evaluate_branch(step)
    }
}

/// `branch` (C11/D3), pure: match `step.on`'s (already late-bound) value
/// against `step.cases` and route. `continue` advances normally
/// (`Completed`); `end` ends the run (`EndRun`, E5). An unmatched value fails
/// `branch_unmatched` (the step's `on_fail` policy applies from there). Free
/// function (rather than a method) so it can be driven directly by tests
/// without constructing a live executor.
fn evaluate_branch(step: &BranchStep) -> StepOutcome {
    let value = step.on.clone();
    match step.cases.get(&value) {
        Some(case) => {
            let target_slug = match case.to {
                BranchTarget::Continue => "continue",
                BranchTarget::End => "end",
            };
            let output = json!({ "value": value, "target": target_slug });
            match case.to {
                BranchTarget::Continue => StepOutcome::Completed { output },
                BranchTarget::End => StepOutcome::EndRun { output },
            }
        }
        None => StepOutcome::Failed {
            code: "branch_unmatched".to_string(),
            message: Some(format!("branch value {value:?} matched no case")),
            output: Some(json!({ "value": value })),
        },
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for WorkflowStepExecutorImpl {
    async fn execute_step(&self, step: &PlanStep, ctx: &StepExecContext) -> StepOutcome {
        let slot = step.slot.as_str();
        // The worktree scope this step resolves to (D-031c): its lane for a
        // grouped step, or the run-level worktree ([`NO_LANE`]) otherwise.
        let scope = worktree_scope(&step.key);
        let meta = InjectionMeta::from_step(step);
        match &step.kind {
            StepKind::AgentConfig(cfg) => self.run_agent_config(slot, cfg).await,
            StepKind::AgentPrompt(agent) => match &agent.goal {
                None => self.run_prompt(slot, agent, &meta, &scope).await,
                Some(goal) => self.run_goal(slot, agent, goal, ctx.step_index, &meta, &scope).await,
            },
            StepKind::AgentEmit(emit) => {
                self.run_emit(slot, emit, ctx.step_index, &meta, &scope).await
            }
            StepKind::ShellRun(shell) => self.run_shell(shell, &scope).await,
            StepKind::ScmOpenPr(pr) => self.run_scm(pr, &scope).await,
            StepKind::Notify(notify) => {
                commands::notify_step(&notify.message, &notify.slack_channel_id)
            }
            StepKind::Branch(branch) => self.run_branch(branch),
        }
    }

    /// §3.7/L16: fire the per-run completion ping after each applied transition.
    /// No gateway block → no ping. Fire-and-forget via the injected sink.
    fn on_step_transition(&self) {
        fire_run_ping(self.gateway.as_ref(), self.deps.run_ping_sink.as_ref());
    }

    /// M2(b): at a clean parallel-group join, merge each lane's branch back into
    /// the run-level worktree, in lane order (deterministic). Delegates to
    /// [`super::parallel`]'s worktree/merge orchestration.
    async fn merge_lanes_into_run_worktree(&self, lanes: &[String]) -> Result<(), StepOutcome> {
        self.merge_lanes_into_run_worktree_impl(lanes).await
    }
}

pub(super) fn failed(code: &str) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: None,
        output: None,
    }
}

pub(super) fn failed_msg(code: &str, message: impl Into<String>) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: Some(message.into()),
        output: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::workflows::plan::BranchCase;

    // --- C11 branch (deny-path floor: run_branch driven directly) ---

    fn branch_step(on: &str) -> BranchStep {
        let mut cases = BTreeMap::new();
        cases.insert(
            "ship".to_string(),
            BranchCase {
                to: BranchTarget::Continue,
            },
        );
        cases.insert(
            "wont_fix".to_string(),
            BranchCase {
                to: BranchTarget::End,
            },
        );
        BranchStep {
            on: on.to_string(),
            cases,
            reason: None,
        }
    }

    #[test]
    fn branch_continue_case_completes_with_continue_shape() {
        let outcome = evaluate_branch(&branch_step("ship"));
        match outcome {
            StepOutcome::Completed { output } => {
                assert_eq!(output["value"], "ship");
                assert_eq!(output["target"], "continue");
            }
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    #[test]
    fn branch_end_case_ends_the_run() {
        // E5: the taken `end` case must surface as EndRun (terminal `completed`,
        // later steps `skipped`), not a plain Completed.
        let outcome = evaluate_branch(&branch_step("wont_fix"));
        match outcome {
            StepOutcome::EndRun { output } => {
                assert_eq!(output["value"], "wont_fix");
                assert_eq!(output["target"], "end");
            }
            other => panic!("expected EndRun, got {other:?}"),
        }
    }

    #[test]
    fn branch_unmatched_value_fails() {
        let outcome = evaluate_branch(&branch_step("neither_case"));
        match outcome {
            StepOutcome::Failed {
                code,
                message,
                output,
            } => {
                assert_eq!(code, "branch_unmatched");
                assert!(message.unwrap().contains("neither_case"));
                assert_eq!(output.unwrap()["value"], "neither_case");
            }
            other => panic!("expected Failed(branch_unmatched), got {other:?}"),
        }
    }
}
