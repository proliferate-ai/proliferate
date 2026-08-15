//! Live transport contract for product-owned per-turn agent context.
//!
//! Product domains implement the resolver; the live actor calls it immediately
//! before rendering and never caches or interprets the returned instruction.

/// Bounded product-owned instruction text resolved from current durable agent
/// role and relationship truth immediately before a prompt is rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentProductContext {
    instruction: String,
}

impl AgentProductContext {
    pub fn new(instruction: impl Into<String>) -> Self {
        Self {
            instruction: instruction.into(),
        }
    }

    pub fn instruction(&self) -> &str {
        &self.instruction
    }
}

/// Current-role lookup as the live actor needs it. Implementations resolve
/// durable product truth on every call; launch-time role snapshots are not a
/// valid implementation of this capability.
pub trait AgentProductContextResolver: Send + Sync {
    fn resolve(
        &self,
        session_id: &str,
    ) -> Result<AgentProductContext, AgentProductContextResolutionError>;
}

/// Internal resolver failure retained for diagnostics while public and log
/// surfaces expose only the bounded incident receipt.
#[derive(thiserror::Error)]
#[error("agent product context resolution failed")]
pub struct AgentProductContextResolutionError {
    class: &'static str,
    #[source]
    source: anyhow::Error,
}

/// Class carried when a resolver does not supply one. Only the transport
/// contract's own fallbacks and test doubles land here; the durable resolver
/// always classifies.
pub const UNCLASSIFIED_PRODUCT_CONTEXT_ERROR: &str = "unclassified";

impl std::fmt::Debug for AgentProductContextResolutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AgentProductContextResolutionError")
            .field("class", &self.class)
            .finish_non_exhaustive()
    }
}

impl AgentProductContextResolutionError {
    pub fn new(source: impl Into<anyhow::Error>) -> Self {
        Self::classified(UNCLASSIFIED_PRODUCT_CONTEXT_ERROR, source)
    }

    /// Preferred constructor: `class` is a stable token owned by the resolving
    /// product domain and is the only failure detail permitted into logs.
    pub fn classified(class: &'static str, source: impl Into<anyhow::Error>) -> Self {
        Self {
            class,
            source: source.into(),
        }
    }

    pub fn class(&self) -> &'static str {
        self.class
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolver_error_display_and_debug_are_redacted() {
        let error = AgentProductContextResolutionError::new(anyhow::anyhow!(
            "sensitive durable relationship detail"
        ));

        assert_eq!(error.to_string(), "agent product context resolution failed");
        assert!(!format!("{error:?}").contains("sensitive durable relationship detail"));
        assert_eq!(error.class(), UNCLASSIFIED_PRODUCT_CONTEXT_ERROR);
    }

    #[test]
    fn classified_resolver_error_keeps_the_class_and_still_redacts() {
        let error = AgentProductContextResolutionError::classified(
            "cross_workspace",
            anyhow::anyhow!("sensitive durable relationship detail"),
        );

        assert_eq!(error.class(), "cross_workspace");
        assert_eq!(error.to_string(), "agent product context resolution failed");
        assert!(!format!("{error:?}").contains("sensitive durable relationship detail"));
    }
}
