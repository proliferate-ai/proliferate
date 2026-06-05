use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    error::WorkerError,
    store::{AppliedRevisionState, ReconcileDomain, RevisionFailure, WorkerStore},
};

#[derive(Debug, Clone, Copy)]
pub struct DesiredRevision {
    pub domain: ReconcileDomain,
    pub revision: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ReconcileDecision {
    Due,
    Current,
    BackingOff { next_attempt_unix_ms: i64 },
    Failed,
}

pub struct ReconcileManager<'a> {
    store: &'a WorkerStore,
}

impl<'a> ReconcileManager<'a> {
    pub fn new(store: &'a WorkerStore) -> Self {
        Self { store }
    }

    pub fn note_desired(
        &self,
        desired: DesiredRevision,
    ) -> Result<AppliedRevisionState, WorkerError> {
        self.store
            .note_desired_revision(desired.domain, desired.revision)
    }

    #[allow(dead_code)]
    pub fn decision(&self, domain: ReconcileDomain) -> Result<ReconcileDecision, WorkerError> {
        let state = self.store.get_applied_revision_state(domain)?;
        Ok(decision_for_state(&state, now_unix_ms()))
    }

    pub fn mark_applied(
        &self,
        domain: ReconcileDomain,
        revision: i64,
    ) -> Result<AppliedRevisionState, WorkerError> {
        self.store.mark_revision_applied(domain, revision)
    }

    #[allow(dead_code)]
    pub fn mark_failed(
        &self,
        domain: ReconcileDomain,
        failure: RevisionFailure<'_>,
    ) -> Result<AppliedRevisionState, WorkerError> {
        self.store.mark_revision_failed(domain, failure)
    }
}

#[allow(dead_code)]
fn decision_for_state(state: &AppliedRevisionState, now_unix_ms: i64) -> ReconcileDecision {
    if state.status == "failed" {
        return ReconcileDecision::Failed;
    }
    if state.desired_revision <= state.applied_revision {
        return ReconcileDecision::Current;
    }
    if let Some(next_attempt_unix_ms) = state.next_attempt_unix_ms {
        if next_attempt_unix_ms > now_unix_ms {
            return ReconcileDecision::BackingOff {
                next_attempt_unix_ms,
            };
        }
    }
    ReconcileDecision::Due
}

#[allow(dead_code)]
fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{decision_for_state, ReconcileDecision};
    use crate::store::{AppliedRevisionState, ReconcileDomain};

    #[test]
    fn due_when_desired_is_ahead_and_not_backing_off() {
        let state = state("pending", 2, 3, None);
        assert_eq!(decision_for_state(&state, 1000), ReconcileDecision::Due);
    }

    #[test]
    fn current_when_applied_catches_desired() {
        let state = state("applied", 3, 3, None);
        assert_eq!(decision_for_state(&state, 1000), ReconcileDecision::Current);
    }

    #[test]
    fn backing_off_until_next_attempt() {
        let state = state("backing_off", 2, 3, Some(2000));
        assert_eq!(
            decision_for_state(&state, 1000),
            ReconcileDecision::BackingOff {
                next_attempt_unix_ms: 2000
            }
        );
        assert_eq!(decision_for_state(&state, 2000), ReconcileDecision::Due);
    }

    fn state(
        status: &str,
        applied_revision: i64,
        desired_revision: i64,
        next_attempt_unix_ms: Option<i64>,
    ) -> AppliedRevisionState {
        AppliedRevisionState {
            domain: ReconcileDomain::Exposures,
            applied_revision,
            desired_revision,
            failure_count: 0,
            next_attempt_unix_ms,
            status: status.to_string(),
            error_code: None,
            error_message: None,
        }
    }
}
