use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::domains::sessions::runtime::startup_errors::map_start_session_error_to_anyhow;
use crate::domains::sessions::runtime::{ForkSessionError, ForkSessionOutcome, SessionRuntime};
use crate::live::sessions::SessionStartupStrategy;

/// Start a child whose adapter owns native fork ids only inside one process.
/// The child/link/prefix and operation are still prepared here; the actor owns
/// the hydration, strict wire CAS, result persistence, and ready finalization.
pub(super) async fn start_prepared_child(
    runtime: &SessionRuntime,
    child: SessionRecord,
    link: SessionLinkRecord,
    operation_id: &str,
    parent_native_session_id: String,
    provider_anchor: Option<ProviderForkAnchor>,
) -> Result<ForkSessionOutcome, ForkSessionError> {
    let startup = SessionStartupStrategy::ForkFromNative {
        fork_operation_id: operation_id.to_string(),
        parent_native_session_id,
        provider_anchor,
    };
    match runtime
        .start_live_session(&child, startup, child.system_prompt_append.clone())
        .await
    {
        Ok((_handle, _native_session_id)) => {
            let updated = runtime
                .session_service
                .get_session(&child.id)
                .map_err(ForkSessionError::Internal)?
                .unwrap_or(child);
            Ok(ForkSessionOutcome {
                session: updated,
                link,
                child_started: true,
            })
        }
        Err(error) => {
            // The prepared CAS covers failures before the wire seam. If actor
            // startup escaped after the claim, conservatively park that exact
            // in-flight operation as outcome-unknown. Both transitions are
            // strict no-ops for result-known or terminal rows.
            let failed_at = chrono::Utc::now().to_rfc3339();
            let _ = runtime
                .session_service
                .store()
                .fail_prepared_process_local_fork(operation_id, &child.id, &failed_at);
            let _ = runtime
                .session_service
                .store()
                .park_process_local_fork_native_outcome_unknown(
                    operation_id,
                    &child.id,
                    &failed_at,
                );
            runtime.mark_session_errored(&child.id);
            let errored = runtime
                .session_service
                .get_session(&child.id)
                .map_err(ForkSessionError::Internal)?
                .unwrap_or(child);
            Err(ForkSessionError::StartFailed {
                session: errored,
                link,
                error: map_start_session_error_to_anyhow(error),
            })
        }
    }
}
