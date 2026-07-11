//! Strict delivery-identity acceptance (WS5a, feature spec §5.3).
//!
//! The immutable delivery identity is `(run_id, plan_hash, binding_hash,
//! execution_generation)`. The identity fields ride the delivered plan JSON as
//! OPTIONAL top-level fields — a legacy delivery omits them and keeps today's
//! behavior (idempotent on `run_id` alone, no identity assertion); WS2c wires
//! the server side to always send them. They are parsed here by a lenient
//! side-struct (never through the strict plan parser: identity acceptance is a
//! delivery concern, not a plan-shape concern), persisted on the run row
//! (immutable after insert), and asserted against any re-delivery.

use serde::Deserialize;

use super::model::WorkflowRunRecord;

/// The optional delivery-identity fields of a delivered plan payload. Both the
/// snake_case runtime spelling and the WS1 camelCase contract spelling parse
/// (`planHash` is the v2 `ResolvedPlan` field; `bindingHash` /
/// `executionGeneration` normally ride the execution envelope but are accepted
/// on the plan surface so a delivery may thread them through either).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct DeliveryIdentity {
    #[serde(default, alias = "planHash")]
    pub plan_hash: Option<String>,
    #[serde(default, alias = "bindingHash")]
    pub binding_hash: Option<String>,
    #[serde(default, alias = "executionGeneration")]
    pub execution_generation: Option<i64>,
}

impl DeliveryIdentity {
    /// Extract the identity fields from a delivered plan payload. Lenient by
    /// design: unknown fields are ignored, absent fields are `None` (the plan
    /// itself is validated by the strict plan parser separately).
    pub fn from_plan_json(plan_json: &str) -> Self {
        serde_json::from_str(plan_json).unwrap_or_default()
    }
}

/// Internal abort marker carried through the `anyhow` transaction boundary so
/// a delivery-identity conflict rolls the transaction back and surfaces as the
/// typed `WorkflowServiceError::DeliveryIdentityConflict` (never a generic
/// store error).
#[derive(Debug, thiserror::Error)]
#[error("delivery identity conflict on {field}")]
pub(super) struct ConflictAbort {
    pub(super) field: &'static str,
}

/// Compare the stored run's delivery identity against a re-delivery's (spec
/// §5.3). Only fields PRESENT on both sides are asserted: an absent side (a
/// legacy delivery, or a stored legacy run) asserts nothing. Returns the first
/// conflicting field name.
pub(super) fn delivery_identity_conflict(
    existing: &WorkflowRunRecord,
    delivered: &DeliveryIdentity,
) -> Option<&'static str> {
    fn conflicts<T: PartialEq>(stored: &Option<T>, delivered: &Option<T>) -> bool {
        matches!((stored, delivered), (Some(a), Some(b)) if a != b)
    }
    if conflicts(&existing.plan_hash, &delivered.plan_hash) {
        return Some("plan_hash");
    }
    if conflicts(&existing.binding_hash, &delivered.binding_hash) {
        return Some("binding_hash");
    }
    if conflicts(&existing.execution_generation, &delivered.execution_generation) {
        return Some("execution_generation");
    }
    None
}
