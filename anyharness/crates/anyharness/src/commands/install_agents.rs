use anyhow::{anyhow, bail, Result};
use clap::Args;

use anyharness_lib::agents::model::AgentKind;
use anyharness_lib::agents::reconcile::{
    reconcile_agents, AgentReconcileOutcome, AgentReconcileResult,
};
use anyharness_lib::agents::registry::built_in_registry;
use anyharness_lib::app::{default_runtime_home, ensure_runtime_home};

#[derive(Args)]
pub struct InstallAgentsArgs {
    #[arg(long)]
    pub runtime_home: Option<String>,

    #[arg(long)]
    pub reinstall: bool,

    #[arg(long = "agent")]
    pub agents: Vec<String>,
}

pub fn run(args: InstallAgentsArgs) -> Result<()> {
    let runtime_home = args
        .runtime_home
        .map(std::path::PathBuf::from)
        .unwrap_or_else(default_runtime_home);

    ensure_runtime_home(&runtime_home)?;

    let requested_agents = resolve_requested_agents(&args.agents)?;
    let registry = selected_registry(&requested_agents);
    let results = reconcile_agents(&registry, &runtime_home, args.reinstall);

    if results.is_empty() {
        bail!("no agents selected for installation");
    }

    for result in &results {
        let installed_count = result.installed_artifacts.len();
        let message = result.message.as_deref().unwrap_or("");
        println!(
            "agent={} outcome={} installed_artifacts={}{}",
            result.kind.as_str(),
            outcome_label(&result.outcome),
            installed_count,
            if message.is_empty() {
                String::new()
            } else {
                format!(" message={message}")
            }
        );
    }

    let failures: Vec<&AgentReconcileResult> = results
        .iter()
        .filter(|result| result.outcome == AgentReconcileOutcome::Failed)
        .collect();
    if !failures.is_empty() {
        let failure_summary = failures
            .into_iter()
            .map(|result| {
                let message = result
                    .message
                    .as_deref()
                    .unwrap_or("managed install failed");
                format!("{}: {}", result.kind.as_str(), message)
            })
            .collect::<Vec<_>>()
            .join("; ");
        return Err(anyhow!("failed to install agents: {failure_summary}"));
    }

    Ok(())
}

fn resolve_requested_agents(requested: &[String]) -> Result<Vec<AgentKind>> {
    if requested.is_empty() {
        return Ok(AgentKind::all().to_vec());
    }

    requested
        .iter()
        .map(|kind| AgentKind::parse(kind).ok_or_else(|| anyhow!("unknown agent kind `{kind}`")))
        .collect()
}

fn selected_registry(
    requested_agents: &[AgentKind],
) -> Vec<anyharness_lib::agents::model::AgentDescriptor> {
    built_in_registry()
        .into_iter()
        .filter(|descriptor| requested_agents.iter().any(|kind| kind == &descriptor.kind))
        .collect()
}

fn outcome_label(outcome: &AgentReconcileOutcome) -> &'static str {
    match outcome {
        AgentReconcileOutcome::Installed => "installed",
        AgentReconcileOutcome::AlreadyInstalled => "already_installed",
        AgentReconcileOutcome::Skipped => "skipped",
        AgentReconcileOutcome::Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_requested_agents;

    #[test]
    fn resolve_requested_agents_defaults_to_all_agents() {
        let agents = resolve_requested_agents(&[]).expect("expected default agents");
        assert_eq!(agents.len(), 5);
        assert!(agents.iter().any(|agent| agent.as_str() == "codex"));
    }

    #[test]
    fn resolve_requested_agents_rejects_unknown_agent() {
        let error = resolve_requested_agents(&["nope".into()]).expect_err("expected parse error");
        assert!(error.to_string().contains("unknown agent kind `nope`"));
    }

    #[test]
    fn resolve_requested_agents_rejects_removed_amp_agent() {
        let error = resolve_requested_agents(&["amp".into()]).expect_err("expected parse error");
        assert!(error.to_string().contains("unknown agent kind `amp`"));
    }
}
