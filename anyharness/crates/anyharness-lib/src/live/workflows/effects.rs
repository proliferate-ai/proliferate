//! Executor-side orchestration of the process-effect commands (`commands.rs`
//! owns the actual shelling-out): `shell.run` and `scm.open_pr` both resolve
//! the step's effective workspace first, then delegate. `notify` needs no
//! workspace and is dispatched straight from `executor::execute_step`. Moved
//! verbatim out of `executor.rs` (WS0B-R).

use std::path::PathBuf;

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{ScmOpenPrStep, ShellRunStep};

use super::commands;
use super::executor::WorkflowStepExecutorImpl;
use crate::live::workflows::isolation::{WorkflowCommandKind, WorkflowProcessIdentity};

impl WorkflowStepExecutorImpl {
    /// The workspace path + env every shell / emit-file drop / verify of this
    /// step resolves to (wave 2b): the step's effective workspace, resolved
    /// (and, under worktree isolation, minted if this is the scope's first
    /// step) via [`Self::effective_workspace_id`].
    pub(super) async fn workspace_ctx(
        &self,
        scope: &str,
    ) -> Result<(PathBuf, Vec<(String, String)>), StepOutcome> {
        let workspace_id = self.effective_workspace_id(scope).await?;
        let workspace = self
            .deps
            .workspace_runtime
            .get_workspace(&workspace_id)
            .map_err(|error| super::executor::failed_msg("workspace_error", error.to_string()))?
            .ok_or_else(|| super::executor::failed("workspace_missing"))?;
        // Workflow effects deliberately do not call `build_workspace_env`:
        // that API merges global/workspace/session secret files. Arbitrary
        // shell and SCM commands get no ambient credentials; later effect
        // packets may issue operation-scoped authority through the broker.
        Ok((PathBuf::from(&workspace.path), Vec::new()))
    }

    pub(super) async fn run_shell(
        &self,
        step: &ShellRunStep,
        scope: &str,
        step_key: &str,
        attempt: i64,
    ) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx(scope).await {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        let identity = match self.step_process_identity(
            step_key,
            attempt,
            WorkflowCommandKind::Shell,
            &workspace_path,
        ) {
            Ok(identity) => identity,
            Err(outcome) => return outcome,
        };
        commands::run_shell_step(
            self.deps.workflow_isolation_broker.as_ref(),
            &self.isolation_capability,
            identity,
            &workspace_path,
            &env,
            step,
        )
        .await
    }

    pub(super) async fn run_scm(
        &self,
        step: &ScmOpenPrStep,
        scope: &str,
        step_key: &str,
        attempt: i64,
    ) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx(scope).await {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        let identity = match self.step_process_identity(
            step_key,
            attempt,
            WorkflowCommandKind::Scm,
            &workspace_path,
        ) {
            Ok(identity) => identity,
            Err(outcome) => return outcome,
        };
        commands::open_pr_step(
            self.deps.workflow_isolation_broker.as_ref(),
            &self.isolation_capability,
            identity,
            &workspace_path,
            &env,
            step,
        )
        .await
    }

    pub(super) fn step_process_identity(
        &self,
        step_key: &str,
        attempt: i64,
        kind: WorkflowCommandKind,
        root: &std::path::Path,
    ) -> Result<WorkflowProcessIdentity, StepOutcome> {
        WorkflowProcessIdentity::try_step(
            self.isolation_capability.identity().clone(),
            step_key,
            attempt,
            kind,
            root,
        )
        .map_err(|error| {
            super::executor::failed_msg(
                "workflow_agent_isolation_unavailable",
                format!("invalid workflow step process identity: {error}"),
            )
        })
    }
}
