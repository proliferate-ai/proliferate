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
        let env = self
            .deps
            .workspace_runtime
            .build_workspace_env(&workspace, None)
            .map_err(|error| super::executor::failed_msg("workspace_env_error", error.to_string()))?;
        Ok((PathBuf::from(&workspace.path), env))
    }

    pub(super) async fn run_shell(&self, step: &ShellRunStep, scope: &str) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx(scope).await {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        commands::run_shell_step(&workspace_path, &env, step).await
    }

    pub(super) async fn run_scm(&self, step: &ScmOpenPrStep, scope: &str) -> StepOutcome {
        let (workspace_path, env) = match self.workspace_ctx(scope).await {
            Ok(ctx) => ctx,
            Err(outcome) => return outcome,
        };
        commands::open_pr_step(&workspace_path, &env, step).await
    }
}
