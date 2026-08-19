//! Narrow durable port for process-local native-fork dispatch.
//!
//! Live owns the wire timing and domains own SQLite. Keeping this surface out
//! of broad session state makes the crash-consistency contract explicit at the
//! one seam that needs it.

pub(crate) trait ForkDispatchDurable: Send + Sync {
    /// Strict prepared -> in-flight CAS immediately before `session/fork`.
    fn claim_native_call(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()>;

    /// Atomically persist `sessions.native_session_id` and advance the fork
    /// operation to `native_result_known`.
    fn record_native_result(
        &self,
        operation_id: &str,
        child_session_id: &str,
        native_child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()>;

    /// Definite failure before the native call was dispatched.
    fn fail_prepared(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()>;

    /// Explicit provider error response after dispatch.
    fn fail_in_flight(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()>;

    /// Ambiguous or malformed outcome after dispatch.
    fn park_outcome_unknown(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()>;

    /// Atomically make the child idle and the operation completed before actor
    /// readiness becomes observable.
    fn finalize_startup(
        &self,
        operation_id: &str,
        child_session_id: &str,
        native_child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()>;
}
