//! Broker-issued descendant process-group identity and child handle.

use std::fmt;

use super::{WorkflowIsolationCapability, WorkflowIsolationError, WorkflowProcessIdentity};

#[derive(Clone, PartialEq, Eq)]
pub struct WorkflowProcessGroup {
    opaque_id: String,
    identity: WorkflowProcessIdentity,
    execution_generation: i64,
    broker_generation: u64,
}

impl fmt::Debug for WorkflowProcessGroup {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowProcessGroup")
            .field("opaque_id", &"[REDACTED]")
            .field("identity", &self.identity)
            .field("execution_generation", &self.execution_generation)
            .field("broker_generation", &self.broker_generation)
            .finish()
    }
}

impl WorkflowProcessGroup {
    pub fn try_new(
        opaque_id: impl Into<String>,
        identity: WorkflowProcessIdentity,
        execution_generation: i64,
        broker_generation: u64,
    ) -> Result<Self, WorkflowIsolationError> {
        let opaque_id = opaque_id.into();
        if opaque_id.trim().is_empty()
            || opaque_id != opaque_id.trim()
            || opaque_id.len() > 256
            || opaque_id.contains('\0')
            || execution_generation <= 0
            || broker_generation == 0
            || execution_generation != identity.delivery().execution_generation()
        {
            return Err(WorkflowIsolationError::InvalidProcessGroup);
        }
        Ok(Self {
            opaque_id,
            identity,
            execution_generation,
            broker_generation,
        })
    }

    pub fn opaque_id(&self) -> &str {
        &self.opaque_id
    }

    pub(super) fn matches(
        &self,
        capability: &WorkflowIsolationCapability,
        identity: &WorkflowProcessIdentity,
    ) -> bool {
        &self.identity == identity
            && identity.delivery() == capability.identity()
            && self.execution_generation == capability.identity().execution_generation()
            && self.broker_generation == capability.broker_generation()
    }

    pub(super) fn matches_capability(&self, capability: &WorkflowIsolationCapability) -> bool {
        self.identity.delivery() == capability.identity()
            && self.execution_generation == capability.identity().execution_generation()
            && self.broker_generation == capability.broker_generation()
    }
}

pub struct BrokeredWorkflowAgentProcess {
    pub child: tokio::process::Child,
    pub process_group: WorkflowProcessGroup,
}
