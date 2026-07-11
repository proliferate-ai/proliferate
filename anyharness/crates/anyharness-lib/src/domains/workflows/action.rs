//! The deterministic action wait/result handshake (WS5b, feature spec §7.4).
//!
//! An action (a templated Slack notification in v1) is a runtime- or
//! server-issued effect, not an agent orchestration decision. The runtime:
//!
//! 1. persists its action effect (the [`super::effects`] ledger row),
//! 2. submits the stable `(run_id, step_key, attempt)` identity to the control
//!    API,
//! 3. enters `waiting_action_result`, and
//! 4. advances its `on_fail` decision only on an authoritative terminal receipt.
//!
//! A lost request/response is recovered with the SAME idempotency identity; it
//! never creates a second action. The server delivers and records the effect
//! but never advances the workflow cursor.
//!
//! This module defines the RUNTIME side: the [`ActionSubmitter`] trait (WS4c
//! plugs the real server task in behind it), the wait/result state machine, a
//! [`LegacyInlineActionSubmitter`] that preserves today's inline notify
//! behavior byte-for-byte, and a [`TestActionSubmitter`] double that proves the
//! waiting / receipt / uncertain / lost-response paths.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use super::engine::StepOutcome;

/// The stable action identity the runtime submits to the control API. Derived
/// from at least `(run_id, step_key, attempt)` so a lost request/response is
/// recovered by the SAME identity — never a second action (§7.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionSubmit {
    pub run_id: String,
    pub step_key: String,
    pub attempt: i64,
    /// The non-secret action payload (v1: the Slack channel + rendered message).
    pub payload: serde_json::Value,
}

/// The server-assigned action identity returned by a submit. A re-submit for
/// the same [`ActionSubmit`] returns the SAME `action_id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionIdentity {
    pub action_id: String,
}

/// The authoritative terminal result of an action (§7.4). The runtime advances
/// its `on_fail` decision only on one of these; a lost result is re-queried by
/// the action identity, not resent.
#[derive(Debug, Clone, PartialEq)]
pub enum ActionResult {
    /// The provider accepted the action; `receipt` is the non-secret record
    /// (channel/message identity for Slack).
    Delivered { receipt: serde_json::Value },
    /// The action failed with a proven-terminal error.
    Failed {
        code: String,
        message: Option<String>,
    },
    /// The provider may have accepted a request but neither idempotency nor
    /// reconciliation can prove it; never resent automatically (§7.4).
    OutcomeUncertain { detail: Option<String> },
}

impl ActionResult {
    /// Map the authoritative result onto the step outcome that drives `on_fail`.
    pub fn into_outcome(self) -> StepOutcome {
        match self {
            ActionResult::Delivered { receipt } => StepOutcome::Completed { output: receipt },
            ActionResult::Failed { code, message } => StepOutcome::Failed {
                code,
                message,
                output: None,
            },
            ActionResult::OutcomeUncertain { detail } => StepOutcome::OutcomeUncertain {
                effect: "action".to_string(),
                detail,
            },
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ActionError {
    #[error("action control-API transport error: {0}")]
    Transport(String),
}

/// The runtime→server action boundary. WS4c implements this against the real
/// control API + transactional outbox; v1 uses [`LegacyInlineActionSubmitter`].
#[async_trait::async_trait]
pub trait ActionSubmitter: Send + Sync {
    /// Submit the action for this stable identity and return the server-assigned
    /// action identity. MUST be idempotent on `(run_id, step_key, attempt)`: a
    /// re-submit for the same identity returns the SAME `action_id` and never
    /// creates a second action (§7.4 lost-request recovery).
    async fn submit(&self, submit: &ActionSubmit) -> Result<ActionIdentity, ActionError>;

    /// Query the authoritative terminal result for a submitted action. `None`
    /// while the server has recorded no terminal receipt yet: the runtime stays
    /// in `waiting_action_result` and re-queries by the SAME identity (§7.4
    /// lost-response recovery).
    async fn poll_result(
        &self,
        action: &ActionIdentity,
    ) -> Result<Option<ActionResult>, ActionError>;
}

/// How long the runtime waits in `waiting_action_result` before it treats the
/// absence of an authoritative result as `outcome_uncertain`.
#[derive(Debug, Clone, Copy)]
pub struct ActionWaitPolicy {
    pub max_polls: u32,
    pub poll_interval: Duration,
}

impl Default for ActionWaitPolicy {
    fn default() -> Self {
        Self {
            max_polls: 600,
            poll_interval: Duration::from_millis(500),
        }
    }
}

/// Drive the §7.4 handshake for a FRESH action effect: submit once (idempotent),
/// stamp the identity onto the ledger via `on_identity` (so a later crash
/// recovers by identity, not a second submit), then wait for an authoritative
/// terminal receipt. Returns the identity plus the terminal result. The wait
/// budget exhausting with no result is `outcome_uncertain`, never a resend.
pub async fn run_action_handshake(
    submitter: &dyn ActionSubmitter,
    submit: &ActionSubmit,
    policy: ActionWaitPolicy,
    mut on_identity: impl FnMut(&ActionIdentity),
) -> Result<(ActionIdentity, ActionResult), ActionError> {
    let identity = submitter.submit(submit).await?;
    on_identity(&identity);
    let result = wait_for_result(submitter, &identity, policy).await?;
    Ok((identity, result))
}

/// Recover a crashed action effect by its KNOWN identity: poll only, NEVER
/// re-submit (§7.4 lost-response recovery). Used when the effect ledger already
/// holds the action id from a prior attempt.
pub async fn recover_action_handshake(
    submitter: &dyn ActionSubmitter,
    identity: &ActionIdentity,
    policy: ActionWaitPolicy,
) -> Result<ActionResult, ActionError> {
    wait_for_result(submitter, identity, policy).await
}

async fn wait_for_result(
    submitter: &dyn ActionSubmitter,
    identity: &ActionIdentity,
    policy: ActionWaitPolicy,
) -> Result<ActionResult, ActionError> {
    for _ in 0..policy.max_polls.max(1) {
        if let Some(result) = submitter.poll_result(identity).await? {
            return Ok(result);
        }
        if !policy.poll_interval.is_zero() {
            tokio::time::sleep(policy.poll_interval).await;
        }
    }
    Ok(ActionResult::OutcomeUncertain {
        detail: Some("no authoritative action result within the wait budget".to_string()),
    })
}

/// The v1 legacy adapter: wraps today's inline notify behavior (the runtime
/// records the rendered message as delivered immediately). Idempotent on the
/// derived action id, so a crash-resume re-submit returns the same id and the
/// same receipt — behavior is unchanged from pre-WS5b. WS4c replaces it with
/// the real control-API + outbox submitter.
#[derive(Default)]
pub struct LegacyInlineActionSubmitter {
    delivered: Mutex<HashMap<String, serde_json::Value>>,
}

impl LegacyInlineActionSubmitter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Deterministic action id from the stable submit identity — the whole point
    /// of §7.4's retry-safety: the same identity always maps to the same action.
    fn action_id(submit: &ActionSubmit) -> String {
        format!(
            "legacy-inline::{}::{}::{}",
            submit.run_id, submit.step_key, submit.attempt
        )
    }
}

#[async_trait::async_trait]
impl ActionSubmitter for LegacyInlineActionSubmitter {
    async fn submit(&self, submit: &ActionSubmit) -> Result<ActionIdentity, ActionError> {
        let action_id = Self::action_id(submit);
        self.delivered
            .lock()
            .unwrap()
            .insert(action_id.clone(), submit.payload.clone());
        Ok(ActionIdentity { action_id })
    }

    async fn poll_result(
        &self,
        action: &ActionIdentity,
    ) -> Result<Option<ActionResult>, ActionError> {
        Ok(self
            .delivered
            .lock()
            .unwrap()
            .get(&action.action_id)
            .cloned()
            .map(|receipt| ActionResult::Delivered { receipt }))
    }
}

/// A scriptable test double proving the waiting / receipt / uncertain /
/// lost-response paths. `poll_script` is consumed front-to-back; each `None`
/// models one "still pending" poll, each `Some` a terminal receipt. It counts
/// submits so a test can prove a lost response recovers WITHOUT a second submit.
pub struct TestActionSubmitter {
    action_id: String,
    submits: AtomicUsize,
    poll_script: Mutex<std::collections::VecDeque<Option<ActionResult>>>,
}

impl TestActionSubmitter {
    pub fn new(action_id: &str, poll_script: Vec<Option<ActionResult>>) -> Self {
        Self {
            action_id: action_id.to_string(),
            submits: AtomicUsize::new(0),
            poll_script: Mutex::new(poll_script.into_iter().collect()),
        }
    }

    /// How many times `submit` was called — the lost-response guard.
    pub fn submits(&self) -> usize {
        self.submits.load(Ordering::SeqCst)
    }
}

#[async_trait::async_trait]
impl ActionSubmitter for TestActionSubmitter {
    async fn submit(&self, _submit: &ActionSubmit) -> Result<ActionIdentity, ActionError> {
        self.submits.fetch_add(1, Ordering::SeqCst);
        Ok(ActionIdentity {
            action_id: self.action_id.clone(),
        })
    }

    async fn poll_result(
        &self,
        _action: &ActionIdentity,
    ) -> Result<Option<ActionResult>, ActionError> {
        Ok(self.poll_script.lock().unwrap().pop_front().flatten())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn submit() -> ActionSubmit {
        ActionSubmit {
            run_id: "run-1".to_string(),
            step_key: "0.-.0".to_string(),
            attempt: 1,
            payload: json!({ "channel": "slack", "message": "hi", "slack_channel_id": "C1" }),
        }
    }

    fn zero_wait() -> ActionWaitPolicy {
        ActionWaitPolicy {
            max_polls: 5,
            poll_interval: Duration::ZERO,
        }
    }

    #[tokio::test]
    async fn legacy_adapter_records_delivered_immediately_unchanged_output() {
        let submitter = LegacyInlineActionSubmitter::new();
        let (identity, result) =
            run_action_handshake(&submitter, &submit(), zero_wait(), |_| {})
                .await
                .unwrap();
        assert!(identity.action_id.contains("run-1"));
        match result.into_outcome() {
            StepOutcome::Completed { output } => {
                // Byte-identical to the pre-WS5b inline notify_step output.
                assert_eq!(output["channel"], "slack");
                assert_eq!(output["message"], "hi");
                assert_eq!(output["slack_channel_id"], "C1");
            }
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn waits_through_pending_polls_then_delivers() {
        let submitter = TestActionSubmitter::new(
            "act-1",
            vec![
                None,
                None,
                Some(ActionResult::Delivered {
                    receipt: json!({ "ts": "1.2" }),
                }),
            ],
        );
        let mut stamped: Option<String> = None;
        let (identity, result) =
            run_action_handshake(&submitter, &submit(), zero_wait(), |id| {
                stamped = Some(id.action_id.clone());
            })
            .await
            .unwrap();
        assert_eq!(identity.action_id, "act-1");
        assert_eq!(stamped.as_deref(), Some("act-1"));
        assert_eq!(submitter.submits(), 1);
        assert!(matches!(result, ActionResult::Delivered { .. }));
    }

    #[tokio::test]
    async fn budget_exhaustion_is_outcome_uncertain_never_resent() {
        // Every poll pending: the wait budget exhausts → uncertain, one submit.
        let submitter = TestActionSubmitter::new("act-1", vec![None, None, None, None, None, None]);
        let (_identity, result) =
            run_action_handshake(&submitter, &submit(), zero_wait(), |_| {})
                .await
                .unwrap();
        assert!(matches!(result, ActionResult::OutcomeUncertain { .. }));
        assert_eq!(submitter.submits(), 1);
        assert!(matches!(
            result.into_outcome(),
            StepOutcome::OutcomeUncertain { .. }
        ));
    }

    #[tokio::test]
    async fn lost_response_recovers_by_identity_without_a_second_submit() {
        // The result was recorded server-side but the response was lost. Recovery
        // polls the KNOWN identity — it must NOT submit again.
        let submitter = TestActionSubmitter::new(
            "act-1",
            vec![Some(ActionResult::Delivered {
                receipt: json!({ "ts": "9.9" }),
            })],
        );
        let identity = ActionIdentity {
            action_id: "act-1".to_string(),
        };
        let result = recover_action_handshake(&submitter, &identity, zero_wait())
            .await
            .unwrap();
        assert!(matches!(result, ActionResult::Delivered { .. }));
        assert_eq!(submitter.submits(), 0, "recovery must never re-submit");
    }
}
