//! Trusted local activation DTOs plus test-only capability fixtures.

use std::fmt;

use serde::Deserialize;

use super::{WorkflowIsolationError, WorkflowProcessIdentity};

#[cfg(test)]
use super::{
    WorkflowDeliveryIdentity, WorkflowIsolationAttestation, WorkflowIsolationCapability,
    WorkflowIsolationEnforcement, WorkflowIsolationPolicy, REQUIRED_GUARANTEES,
};

#[cfg(test)]
pub(crate) fn test_isolation_policy() -> WorkflowIsolationPolicy {
    WorkflowIsolationPolicy::try_new(
        [std::path::PathBuf::from(
            "/var/empty/anyharness-runtime-private",
        )],
        ["http://127.0.0.1:8457".to_string()],
        [std::env::temp_dir(), std::path::PathBuf::from("/tmp")],
        Vec::new(),
    )
    .expect("valid test isolation policy")
}

#[cfg(test)]
pub(crate) fn test_isolation_capability(
    identity: WorkflowDeliveryIdentity,
) -> WorkflowIsolationCapability {
    let policy = test_isolation_policy();
    test_isolation_capability_with_policy(identity, policy)
}

#[cfg(test)]
pub(crate) fn test_isolation_capability_for_materialization(
    identity: WorkflowDeliveryIdentity,
    target_root: std::path::PathBuf,
) -> WorkflowIsolationCapability {
    let policy = WorkflowIsolationPolicy::try_new(
        [std::path::PathBuf::from(
            "/var/empty/anyharness-runtime-private",
        )],
        ["http://127.0.0.1:8457".to_string()],
        [std::env::temp_dir(), std::path::PathBuf::from("/tmp")],
        [target_root],
    )
    .expect("valid test materialization isolation policy");
    test_isolation_capability_with_policy(identity, policy)
}

#[cfg(test)]
fn test_isolation_capability_with_policy(
    identity: WorkflowDeliveryIdentity,
    policy: WorkflowIsolationPolicy,
) -> WorkflowIsolationCapability {
    let attestation = WorkflowIsolationAttestation::new(
        "test-capability",
        identity,
        "test-backend-v1",
        policy.version(),
        1,
        policy.digest(),
        WorkflowIsolationEnforcement::PlatformSandbox,
        REQUIRED_GUARANTEES,
    )
    .expect("valid test isolation attestation");
    WorkflowIsolationCapability {
        attestation,
        policy,
    }
}

/// Agent-controlled wrapper accepted by the local integration broker. Trusted
/// activation is deliberately absent and unknown sibling fields are rejected.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentGatewayInvocation {
    pub provider_definition_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// Activation context is constructed only from the runtime's broker capability;
/// it is not deserializable from agent JSON.
#[derive(Clone, PartialEq, Eq)]
pub struct TrustedActivationContext {
    activation_id: String,
    process_identity: WorkflowProcessIdentity,
}

impl fmt::Debug for TrustedActivationContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TrustedActivationContext")
            .field("activation_id", &"[REDACTED]")
            .field("process_identity", &self.process_identity)
            .finish()
    }
}

impl TrustedActivationContext {
    pub(crate) fn new(
        activation_id: impl Into<String>,
        process_identity: WorkflowProcessIdentity,
    ) -> Result<Self, WorkflowIsolationError> {
        let activation_id = activation_id.into();
        if activation_id.trim().is_empty() {
            return Err(WorkflowIsolationError::InvalidAttestation);
        }
        Ok(Self {
            activation_id,
            process_identity,
        })
    }

    pub fn activation_id(&self) -> &str {
        &self.activation_id
    }

    pub fn process_identity(&self) -> &WorkflowProcessIdentity {
        &self.process_identity
    }
}
