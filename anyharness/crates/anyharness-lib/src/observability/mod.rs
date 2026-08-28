pub mod latency;
pub mod lifecycle;
pub mod resource_pressure;
pub mod transcript_phase;

/// Agent-owned stderr may contain prompts, provider responses, or other raw
/// child-process output. Keep the target stable so vendor telemetry can
/// exclude it while console and file logging retain the local diagnostic.
pub const AGENT_STDERR_TRACING_TARGET: &str = "anyharness.agent_stderr";

/// Handled, user-visible runtime failures that own one canonical incident.
///
/// Keep this target stable: the AnyHarness Sentry adapter uses it to attach
/// the incident fingerprint and the bounded request-span context without
/// changing ordinary runtime error grouping.
pub const RUNTIME_INCIDENT_TRACING_TARGET: &str = "anyharness.runtime_incident";

/// Every product MCP capability-token rejection, with the session, workspace,
/// endpoint slug, and rejection reason as fields — and never the token itself.
///
/// Keep this target stable: expired-token incidents surface at the agent as a
/// generic client failure, so this event is the one server-side trace that a
/// session's product tools died of auth rather than of the tool call.
pub const PRODUCT_MCP_AUTH_REJECTED_TRACING_TARGET: &str = "anyharness.product_mcp_auth_rejected";

/// The gen-2 workflow engine's named events (the Workflows ADR observability
/// table). Each target maps to one named diagnostics event in telemetry
/// setup; keep both sides stable so dashboards survive refactors.
pub const WORKFLOW_RUN_STARTED_TRACING_TARGET: &str = "anyharness.workflow_run_started";
pub const WORKFLOW_RUN_ACCEPTED_TRACING_TARGET: &str = "anyharness.workflow_run_accepted";
pub const WORKFLOW_WORKSPACE_MATERIALIZED_TRACING_TARGET: &str =
    "anyharness.workflow_workspace_materialized";
pub const WORKFLOW_TRANSITION_TRACING_TARGET: &str = "anyharness.workflow_transition";
pub const WORKFLOW_NODE_LAUNCHED_TRACING_TARGET: &str = "anyharness.workflow_node_launched";
pub const WORKFLOW_RUN_FINISHED_TRACING_TARGET: &str = "anyharness.workflow_run_finished";
pub const WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET: &str =
    "anyharness.workflow_notification_stale";
pub const WORKFLOW_TRANSITION_ILLEGAL_TRACING_TARGET: &str =
    "anyharness.workflow_transition_illegal";
pub const WORKFLOW_NODE_LAUNCH_FAILED_TRACING_TARGET: &str =
    "anyharness.workflow_node_launch_failed";
pub const WORKFLOW_BOOT_FENCE_TRACING_TARGET: &str = "anyharness.workflow_boot_fence";
pub const WORKFLOW_INVARIANT_VIOLATION_TRACING_TARGET: &str =
    "anyharness.workflow_invariant_violation";
pub const WORKFLOW_NODE_INTERACTION_REQUESTED_TRACING_TARGET: &str =
    "anyharness.workflow_node_interaction_requested";
pub const WORKFLOW_NODE_INTERACTION_RESOLVED_TRACING_TARGET: &str =
    "anyharness.workflow_node_interaction_resolved";
pub const WORKFLOW_INTERJECTION_HELD_TRACING_TARGET: &str = "anyharness.workflow_interjection_held";
