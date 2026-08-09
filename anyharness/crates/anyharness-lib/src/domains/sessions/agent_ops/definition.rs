use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport,
};

use crate::domains::sessions::mcp_bindings::product_launch::ProductMcpSelectionContext;
use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

// The product id is signed into every capability token and the route slug is
// baked into the harness config at launch; both are frozen for the lifetime of
// an already-launched session. So the id keeps its original value (old tokens
// keep validating) and the old slug stays routable next to the new one.
pub const ID: &str = "subagents";
pub const ROUTE_SLUG: &str = "agent-ops";
pub const LEGACY_ROUTE_SLUGS: &[&str] = &["subagents"];
// Harness-side server name: transcript receipts are keyed on the resulting
// `mcp__subagents__*` tool names in the SDK reducer and the client, so it is
// renamed with the client step rather than here.
pub const ACP_SERVER_NAME: &str = "subagents";

pub const INSTRUCTIONS: &str = concat!(
    "Use Proliferate agent ops tools to create, message, inspect, search, and close same-workspace child agent sessions. ",
    "Prefer these tools over provider-native or internal subagent tools when same-workspace delegation overlaps."
);

pub const DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: ID,
    route_slug: ROUTE_SLUG,
    legacy_route_slugs: LEGACY_ROUTE_SLUGS,
    acp_server_name: ACP_SERVER_NAME,
    server_info_name: "proliferate-agent-ops",
    display_name: "Agent ops",
    description: "Create and supervise other agent sessions.",
    visibility: ProductMcpVisibility::Internal,
    instructions: INSTRUCTIONS,
    unauthorized_code: "SUBAGENT_MCP_UNAUTHORIZED",
    request_invalid_code: "SUBAGENT_MCP_REQUEST_INVALID",
    prompt_policy: ProductMcpPromptPolicy::System,
};

/// Agent ops mounts on every session. Every real condition (subagents enabled,
/// depth, fanout, workspace surface) is recomputed per call instead, which is
/// what makes blocking at call time possible on a launch-frozen mount.
pub fn should_attach(_ctx: ProductMcpSelectionContext<'_>) -> anyhow::Result<bool> {
    Ok(true)
}

pub fn binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: format!("internal:{ID}"),
        server_name: ACP_SERVER_NAME.to_string(),
        display_name: Some("Agent ops".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::domains::sessions::mcp_bindings::product_catalog::select_product_mcps;
    use crate::domains::sessions::mcp_bindings::product_launch::ProductMcpLaunchRegistration;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };

    fn workspace(surface: WorkspaceSurface) -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: "repo-root-1".to_string(),
            path: "/tmp/workspace-1".to_string(),
            surface,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-08-07T00:00:00Z".to_string(),
            updated_at: "2026-08-07T00:00:00Z".to_string(),
        }
    }

    fn session(subagents_enabled: bool) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-07T00:00:00Z".to_string(),
            updated_at: "2026-08-07T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled,
            action_capabilities_json: None,
            origin: None,
        }
    }

    /// Exercises `should_attach` the way production actually calls it — through
    /// a real `ProductMcpLaunchRegistration` and `select_product_mcps` — rather
    /// than invoking `should_attach` directly. `should_attach` ignores its
    /// argument, so calling it directly makes this assertion vacuously true
    /// regardless of what the selector does; routing through selection at
    /// least proves the registration/selection wiring itself doesn't
    /// reintroduce filtering (e.g. a selector swapped in at the registration
    /// call site) and would fail if `should_attach` ever went back to
    /// returning `false` for any of these cases.
    ///
    /// The surface sweep is coverage-pinned below rather than left as a bare
    /// literal: narrowing it (dropping the retired-but-still-loadable `Cowork`
    /// surface, say) would otherwise silently stop testing a live case instead
    /// of failing.
    #[test]
    fn mounts_for_sessions_the_subagents_mcp_used_to_skip() {
        let mut covered_standard = false;
        let mut covered_cowork = false;
        for surface in [WorkspaceSurface::Standard, WorkspaceSurface::Cowork] {
            // Exhaustive: adding a `WorkspaceSurface` variant stops this
            // compiling until the sweep above covers it too.
            match surface {
                WorkspaceSurface::Standard => covered_standard = true,
                WorkspaceSurface::Cowork => covered_cowork = true,
            }
            for subagents_enabled in [true, false] {
                let workspace = workspace(surface);
                let session = session(subagents_enabled);
                let registration = ProductMcpLaunchRegistration::new(
                    &DEFINITION,
                    Arc::new(should_attach),
                    Arc::new(|_workspace_id: &str, _session_id: &str| Ok("token".to_string())),
                );

                let registrations = [registration];
                let selected = select_product_mcps(&workspace, &session, &registrations)
                    .expect("select product MCPs");

                assert_eq!(
                    selected.len(),
                    1,
                    "expected agent ops to be selected for surface={surface:?} subagents_enabled={subagents_enabled}"
                );
                assert_eq!(selected[0].registration.definition().id, ID);
            }
        }
        assert!(
            covered_standard,
            "the surface sweep must still cover WorkspaceSurface::Standard"
        );
        assert!(
            covered_cowork,
            "the surface sweep must still cover WorkspaceSurface::Cowork: \
             cowork is deleted but the surface value is retained and legacy \
             cowork workspaces are ordinary, reachable workspaces, so a \
             session in one is a live mount case"
        );
    }

    #[test]
    fn compat_anchors_stay_frozen_for_already_launched_sessions() {
        assert_eq!(DEFINITION.id, "subagents");
        assert!(DEFINITION.legacy_route_slugs.contains(&"subagents"));
        assert_eq!(DEFINITION.route_slug, "agent-ops");
        // Wire-name prefix for every tool: renaming this rotates
        // `mcp__subagents__*` to `mcp__agent_ops__*` for live sessions and
        // breaks every SDK reducer / client presentation arm that keys on the
        // old prefix, including for newly launched sessions (the tool-name
        // alias table does not help here — the prefix, not the suffix, would
        // have changed).
        assert_eq!(ACP_SERVER_NAME, "subagents");
    }
}
