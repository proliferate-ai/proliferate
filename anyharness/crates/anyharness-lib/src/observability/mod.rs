pub mod latency;
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

/// The gen-2 workflow engine's named events (the Workflows ADR observability
/// table). Each target maps to one named diagnostics event in telemetry
/// setup; keep both sides stable so dashboards survive refactors.
pub const WORKFLOW_RUN_STARTED_TRACING_TARGET: &str = "anyharness.workflow_run_started";
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
