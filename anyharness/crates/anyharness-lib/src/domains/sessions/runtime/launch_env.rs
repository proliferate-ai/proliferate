//! Per-harness session launch env that is NOT auth.
//!
//! Everything credential- or provider-shaped belongs to the route-auth render
//! plane (`domains/agent_auth/route_auth/`). Native profiles render no auth delta;
//! routed profiles materialize only the selected route. What remains here is the
//! launch wiring that has nothing to do with which credential was selected:
//! pointing claude's ACP adapter at the managed native CLI, and passing the
//! requested model through.
//!
//! Codex used to be handled here too, via a second isolated home
//! (`agent-auth/codex-local/`) written on EVERY codex launch from a Rust constant
//! that pinned `model = "gpt-5.5"`. That was three problems at once: a model name
//! in code, a competing `CODEX_HOME` that
//! route-auth's own home shadowed on routed launches, and a copy of the user's
//! `auth.json` left on disk for launches that never read it. Native Codex now
//! inherits its own home unchanged; only routed profiles receive an isolated
//! `CODEX_HOME`.

use std::collections::BTreeMap;

use crate::domains::agents::model::{AgentKind, ResolvedAgent};

/// Claude's observed `default` selector means "use the harness's own default";
/// it is not a model name the CLI accepts through `ANTHROPIC_MODEL`. Preserve the
/// exact selected value in session intent, but omit this one selector from spawn
/// env so the live harness can apply/confirm it through its configuration API.
const CLAUDE_DEFAULT_MODEL_SELECTOR: &str = "default";

pub(super) fn build_session_launch_env(
    resolved_agent: &ResolvedAgent,
    requested_model_id: Option<&str>,
) -> anyhow::Result<BTreeMap<String, String>> {
    match resolved_agent.descriptor.kind {
        AgentKind::Claude => build_claude_session_launch_env(resolved_agent, requested_model_id),
        // Routed Codex configuration belongs to route_auth; native Codex and
        // every other harness need no non-auth launch env here.
        AgentKind::Codex | AgentKind::OpenCode | AgentKind::Cursor | AgentKind::Grok => {
            Ok(BTreeMap::new())
        }
    }
}

fn build_claude_session_launch_env(
    resolved_agent: &ResolvedAgent,
    requested_model_id: Option<&str>,
) -> anyhow::Result<BTreeMap<String, String>> {
    let mut env = BTreeMap::new();

    if let Some(path) = resolved_agent
        .native
        .as_ref()
        .and_then(|artifact| artifact.path.as_ref())
    {
        env.insert(
            "CLAUDE_CODE_EXECUTABLE".to_string(),
            path.to_string_lossy().into_owned(),
        );
    }

    if let Some(model_id) = requested_model_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| !value.eq_ignore_ascii_case(CLAUDE_DEFAULT_MODEL_SELECTOR))
    {
        env.insert("ANTHROPIC_MODEL".to_string(), model_id.to_string());
    }

    Ok(env)
}
