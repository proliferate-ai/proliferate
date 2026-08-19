//! Turn-start checkpoint hook (Lane H) for the prompt dispatch seams. Kept
//! beside `prompt.rs` (rather than inline in it) so the dispatch file stays
//! within its size ratchet; these are inherent methods on [`SessionRuntime`]
//! called from the three `prompt.rs` dispatch sites.

use super::{SendPromptError, SessionRuntime};
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError, PromptAcceptance};

impl SessionRuntime {
    /// Turn-start checkpoint capture (Lane H), called at every prompt dispatch
    /// seam just before `handle.send_prompt`. Returns the captured checkpoint id
    /// (to be finalized after dispatch), or `None` when nothing was captured.
    ///
    /// Flag-off is zero work: no store reads, no git. A busy handle means the
    /// prompt will queue mid-turn, and a snapshot labelled as THIS boundary would
    /// be dishonest, so capture is skipped. On a capture failure the selected
    /// [`TURN_START_CAPTURE_FAILURE_POLICY`] decides: `Abort` returns a typed
    /// error (the turn never starts), `Degrade` warns and proceeds without a
    /// checkpoint.
    ///
    /// Known gap: turns started by the actor draining its own queue get no
    /// checkpoint in this PR — the hook lives at the runtime dispatch seam, not
    /// inside the actor's queue-replay loop.
    pub(super) async fn capture_turn_start_checkpoint(
        &self,
        workspace_id: &str,
        session_id: &str,
        handle: &crate::live::sessions::LiveSessionHandle,
        prompt_id: Option<&str>,
    ) -> Result<Option<String>, SendPromptError> {
        use crate::domains::workspaces::checkpoints::flags::{
            checkpoint_capture_enabled, CaptureFailurePolicy, TURN_START_CAPTURE_FAILURE_POLICY,
        };
        if !checkpoint_capture_enabled() {
            return Ok(None);
        }
        if handle.is_busy() {
            // Coverage metric (observation phase): the prompt will queue, so the
            // eventual queue-drain turn start is NOT covered by this dispatch-seam
            // hook. Emit at info with stable field names so this observed
            // dispatch-skip class is countable under the flag.
            tracing::info!(
                reason = "busy_will_queue",
                session_id = %session_id,
                "checkpoint.capture.skipped"
            );
            return Ok(None);
        }
        match self
            .checkpoint_service
            .capture_turn_start_under_workspace_lease(
                workspace_id,
                Some(session_id.to_string()),
                prompt_id.map(str::to_string),
            )
            .await
        {
            Ok(record) => Ok(Some(record.id)),
            Err(error) => {
                let failure_class = error.failure_class();
                match TURN_START_CAPTURE_FAILURE_POLICY {
                    CaptureFailurePolicy::Abort => {
                        tracing::error!(
                            session_id = %session_id,
                            sentry_code = "CHECKPOINT_CAPTURE_FAILED",
                            failure_class,
                            "checkpoint capture failed; refusing prompt"
                        );
                        Err(SendPromptError::CheckpointCaptureFailed {
                            failure: error.public_failure(),
                        })
                    }
                    CaptureFailurePolicy::Degrade => {
                        tracing::warn!(
                            session_id = %session_id,
                            failure_class,
                            "checkpoint capture failed; proceeding without a checkpoint (degrade policy)"
                        );
                        Ok(None)
                    }
                }
            }
        }
    }

    /// Settle a captured boundary from the actor's raw command outcome before
    /// the caller maps that outcome into its public error shape. `Started`
    /// binds the turn; `Queued` and definitive non-acceptance discard the
    /// checkpoint. A dropped response is acknowledgement-ambiguous, so its
    /// unbound row and refs stay intact until ordinary retention ages them out.
    ///
    /// Settlement is non-fatal: it never changes the actor command's result.
    pub(super) async fn settle_turn_start_checkpoint(
        &self,
        checkpoint_id: Option<String>,
        outcome: &Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>>,
    ) {
        let Some(checkpoint_id) = checkpoint_id else {
            return;
        };
        match outcome {
            Ok(PromptAcceptance::Started { turn_id }) => {
                if let Err(_error) = self.checkpoint_service.set_turn_id(&checkpoint_id, turn_id) {
                    tracing::warn!(
                        checkpoint_id = %checkpoint_id,
                        sentry_code = "CHECKPOINT_SETTLEMENT_FAILED",
                        failure_stage = "turn_id_backfill",
                        "could not backfill a checkpoint's turn_id after dispatch"
                    );
                }
            }
            Ok(PromptAcceptance::Queued { .. })
            | Err(LiveSessionCommandError::ActorUnavailable)
            | Err(LiveSessionCommandError::Rejected(_)) => {
                // Coverage metric (observation phase): a checkpoint was captured
                // for a boundary that never started, so it is discarded. Stable
                // field names are counted alongside checkpoint.capture.skipped.
                let reason = match outcome {
                    Ok(PromptAcceptance::Queued { .. }) => "queued",
                    Err(LiveSessionCommandError::ActorUnavailable) => "actor_unavailable",
                    Err(LiveSessionCommandError::Rejected(_)) => "rejected",
                    _ => unreachable!("matched definitive non-start outcome"),
                };
                tracing::info!(
                    checkpoint_id = %checkpoint_id,
                    reason,
                    "checkpoint.capture.discarded"
                );
                if let Err(_error) = self
                    .checkpoint_service
                    .expire_and_delete(&checkpoint_id)
                    .await
                {
                    tracing::warn!(
                        checkpoint_id = %checkpoint_id,
                        sentry_code = "CHECKPOINT_SETTLEMENT_FAILED",
                        failure_stage = "discard_after_dispatch",
                        "could not expire a checkpoint for a boundary that did not start"
                    );
                }
            }
            Err(LiveSessionCommandError::ResponseDropped) => tracing::warn!(
                checkpoint_id = %checkpoint_id,
                reason = "response_dropped",
                "checkpoint.capture.unresolved"
            ),
        }
    }
}
