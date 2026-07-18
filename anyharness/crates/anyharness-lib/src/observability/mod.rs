pub mod latency;
pub mod resource_pressure;
pub mod transcript_phase;

/// Agent-owned stderr may contain prompts, provider responses, or other raw
/// child-process output. Keep the target stable so vendor telemetry can
/// exclude it while console and file logging retain the local diagnostic.
pub const AGENT_STDERR_TRACING_TARGET: &str = "anyharness.agent_stderr";
