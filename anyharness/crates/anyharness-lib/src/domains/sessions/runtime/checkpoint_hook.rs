//! Turn-start checkpoint hook (Lane H) for the prompt dispatch seams. Kept
//! beside `prompt.rs` (rather than inline in it) so the dispatch file stays
//! within its size ratchet; these are inherent methods on [`SessionRuntime`]
//! called from the three `prompt.rs` dispatch sites.

use super::{SendPromptError, SessionRuntime};
use crate::live::sessions::PromptAcceptance;

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
        use crate::domains::workspaces::checkpoints::CheckpointOrigin;

        if !checkpoint_capture_enabled() {
            return Ok(None);
        }
        if handle.is_busy() {
            // Coverage metric (observation phase): the prompt will queue, so the
            // eventual queue-drain turn start is NOT covered by this dispatch-seam
            // hook. Emit at info with stable field names so every uncovered turn
            // start is countable under the flag.
            tracing::info!(
                reason = "busy_will_queue",
                session_id = %session_id,
                "checkpoint.capture.skipped"
            );
            return Ok(None);
        }
        match self
            .checkpoint_service
            .capture(
                workspace_id,
                CheckpointOrigin::TurnStart,
                Some(session_id.to_string()),
                prompt_id.map(str::to_string),
            )
            .await
        {
            Ok(record) => Ok(Some(record.id)),
            Err(error) => match TURN_START_CAPTURE_FAILURE_POLICY {
                CaptureFailurePolicy::Abort => Err(SendPromptError::CheckpointCaptureFailed {
                    reason: error.to_string(),
                }),
                CaptureFailurePolicy::Degrade => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "checkpoint capture failed; proceeding without a checkpoint (degrade policy)"
                    );
                    Ok(None)
                }
            },
        }
    }

    /// Post-dispatch bookkeeping for a turn-start checkpoint. `Started` backfills
    /// the real `turn_id`; `Queued` means the race was lost, so the checkpoint is
    /// expired and its refs deleted. Non-fatal: a bookkeeping error is logged, it
    /// never fails a prompt whose command was already accepted.
    pub(super) async fn finalize_turn_start_checkpoint(
        &self,
        checkpoint_id: Option<String>,
        acceptance: &PromptAcceptance,
    ) {
        let Some(checkpoint_id) = checkpoint_id else {
            return;
        };
        match acceptance {
            PromptAcceptance::Started { turn_id } => {
                if let Err(error) = self.checkpoint_service.set_turn_id(&checkpoint_id, turn_id) {
                    tracing::warn!(
                        checkpoint_id = %checkpoint_id,
                        error = %error,
                        "could not backfill a checkpoint's turn_id after dispatch"
                    );
                }
            }
            PromptAcceptance::Queued { .. } => {
                // Coverage metric (observation phase): a checkpoint was captured
                // for a boundary that turned out to queue, so it is discarded. Stable
                // field names, counted alongside checkpoint.capture.skipped.
                tracing::info!(
                    checkpoint_id = %checkpoint_id,
                    "checkpoint.capture.discarded_queued"
                );
                if let Err(error) = self
                    .checkpoint_service
                    .expire_and_delete(&checkpoint_id)
                    .await
                {
                    tracing::warn!(
                        checkpoint_id = %checkpoint_id,
                        error = %error,
                        "could not expire a checkpoint whose turn queued"
                    );
                }
            }
        }
    }
}
