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
