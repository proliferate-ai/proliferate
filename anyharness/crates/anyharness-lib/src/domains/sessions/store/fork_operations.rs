//! Forks ADR rung 2: durable `fork_operations` records (identity/idempotency +
//! provenance). See `sql/0070_fork_operations.sql` and ADR section 4.4.

use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};

/// The provenance + native-result fields resolved once a fork's native call
/// returns; applied to the operation row atomically with the child + link.
#[derive(Debug, Clone, Default)]
pub struct ForkOperationChildResult {
    pub provider_anchor_kind: Option<String>,
    pub provider_anchor_value: Option<String>,
    pub provider_anchor_inclusive: Option<bool>,
    pub prefix_terminal_seq: Option<i64>,
    pub prefix_digest: Option<String>,
    pub adapter_version: Option<String>,
    pub native_version: Option<String>,
    pub native_child_session_id: Option<String>,
}

impl SessionStore {
    /// Persist a fork operation in its initial `prepared` phase. The unique
    /// `idempotency_key` is the atomic guard against a concurrent duplicate
    /// request; callers resolve conflicts via [`find_fork_operation_by_key`]
    /// first (see `fork.rs`).
    pub fn insert_fork_operation(&self, record: &ForkOperationRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            insert_fork_operation_row(conn, record)?;
            Ok(())
        })
    }

    pub fn find_fork_operation_by_key(
        &self,
        idempotency_key: &str,
    ) -> anyhow::Result<Option<ForkOperationRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {FORK_OP_COLUMNS} FROM fork_operations WHERE idempotency_key = ?1"
                ),
                params![idempotency_key],
                map_fork_operation,
            )
            .optional()
        })
    }

    pub fn find_fork_operation_by_child(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<ForkOperationRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {FORK_OP_COLUMNS} FROM fork_operations WHERE child_session_id = ?1"
                ),
                params![child_session_id],
                map_fork_operation,
            )
            .optional()
        })
    }

    /// Advance a fork operation's phase (forward-only in practice; the store
    /// does not enforce ordering, callers do).
    pub fn mark_fork_operation_phase(
        &self,
        id: &str,
        phase: ForkOperationPhase,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE fork_operations SET phase = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, phase.as_str(), now],
            )?;
            Ok(())
        })
    }

    /// Strict process-local fork CAS at the native wire seam. The child row and
    /// its fork operation must already exist in the prepared state, but no
    /// native request has been issued yet.
    pub fn claim_process_local_fork_native_call(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_tx_anyhow(|conn| {
            let changed = conn.execute(
                "UPDATE fork_operations
                 SET phase = 'native_call_in_flight', updated_at = ?3
                 WHERE id = ?1 AND child_session_id = ?2
                   AND phase = 'prepared'
                   AND native_child_session_id IS NULL
                   AND EXISTS (
                     SELECT 1 FROM sessions
                     WHERE sessions.id = fork_operations.child_session_id
                       AND sessions.status = 'starting'
                       AND sessions.native_session_id IS NULL
                       AND sessions.closed_at IS NULL
                   )",
                params![operation_id, child_session_id, now],
            )?;
            anyhow::ensure!(
                changed == 1,
                "process-local fork native-call claim did not match prepared child"
            );
            Ok(())
        })
    }

    /// Persist the returned process-local child id and the known-result phase in
    /// one transaction. `fork_operations.native_child_session_id` deliberately
    /// remains nullable: the child session row owns its native id for Claude's
    /// process-local lifecycle.
    pub fn record_process_local_fork_native_result(
        &self,
        operation_id: &str,
        child_session_id: &str,
        native_child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_tx_anyhow(|conn| {
            let session_changed = conn.execute(
                "UPDATE sessions
                 SET native_session_id = ?2, updated_at = ?3
                 WHERE id = ?1
                   AND status = 'starting'
                   AND native_session_id IS NULL
                   AND closed_at IS NULL",
                params![child_session_id, native_child_session_id, now],
            )?;
            anyhow::ensure!(
                session_changed == 1,
                "process-local fork native result did not match starting child"
            );

            let operation_changed = conn.execute(
                "UPDATE fork_operations
                 SET phase = 'native_result_known', updated_at = ?3
                 WHERE id = ?1 AND child_session_id = ?2
                   AND phase = 'native_call_in_flight'
                   AND native_child_session_id IS NULL",
                params![operation_id, child_session_id, now],
            )?;
            anyhow::ensure!(
                operation_changed == 1,
                "process-local fork native result did not match in-flight operation"
            );
            Ok(())
        })
    }

    pub fn fail_prepared_process_local_fork(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.transition_process_local_fork_failure(
            child_session_id,
            operation_id,
            "prepared",
            "failed",
            now,
        )
    }

    pub fn fail_in_flight_process_local_fork(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.transition_process_local_fork_failure(
            child_session_id,
            operation_id,
            "native_call_in_flight",
            "failed",
            now,
        )
    }

    pub fn park_process_local_fork_native_outcome_unknown(
        &self,
        operation_id: &str,
        child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.transition_process_local_fork_failure(
            child_session_id,
            operation_id,
            "native_call_in_flight",
            "native_outcome_unknown",
            now,
        )
    }

    fn transition_process_local_fork_failure(
        &self,
        child_session_id: &str,
        operation_id: &str,
        expected_phase: &str,
        next_phase: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_tx_anyhow(|conn| {
            let operation_changed = conn.execute(
                "UPDATE fork_operations
                 SET phase = ?4, updated_at = ?5
                 WHERE id = ?1 AND child_session_id = ?2 AND phase = ?3",
                params![
                    operation_id,
                    child_session_id,
                    expected_phase,
                    next_phase,
                    now
                ],
            )?;
            anyhow::ensure!(
                operation_changed == 1,
                "process-local fork failure transition missed expected phase"
            );
            // The live actor's own exit disposition may already have errored the
            // child by the time this durable transition runs (both observe the
            // same failed startup). `errored` is the state this transition
            // establishes, so accepting it keeps the phase transition from being
            // rolled back by a benign race; any other status is a real mismatch.
            let session_changed = conn.execute(
                "UPDATE sessions
                 SET status = 'errored', updated_at = ?2
                 WHERE id = ?1
                   AND status IN ('starting', 'errored')
                   AND closed_at IS NULL",
                params![child_session_id, now],
            )?;
            anyhow::ensure!(
                session_changed == 1,
                "process-local fork failure did not match starting child"
            );
            Ok(())
        })
    }

    /// Final readiness fence for a process-local fork. The actor cannot publish
    /// ready until this transaction has made both durable truths terminal.
    pub fn finalize_process_local_fork_startup(
        &self,
        operation_id: &str,
        child_session_id: &str,
        native_child_session_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_tx_anyhow(|conn| {
            let session_changed = conn.execute(
                "UPDATE sessions
                 SET status = 'idle', updated_at = ?3
                 WHERE id = ?1
                   AND status = 'starting'
                   AND native_session_id = ?2
                   AND closed_at IS NULL",
                params![child_session_id, native_child_session_id, now],
            )?;
            anyhow::ensure!(
                session_changed == 1,
                "process-local fork finalization did not match native child"
            );
            let operation_changed = conn.execute(
                "UPDATE fork_operations
                 SET phase = 'completed', updated_at = ?3
                 WHERE id = ?1 AND child_session_id = ?2
                   AND phase = 'native_result_known'",
                params![operation_id, child_session_id, now],
            )?;
            anyhow::ensure!(
                operation_changed == 1,
                "process-local fork finalization did not match known result"
            );
            Ok(())
        })
    }
}

pub(super) const FORK_OP_COLUMNS: &str = "id, idempotency_key, request_digest, \
     parent_session_id, child_session_id, phase, anchor_turn_id, anchor_item_id, \
     provider_anchor_kind, provider_anchor_value, provider_anchor_inclusive, \
     prefix_terminal_seq, prefix_digest, adapter_version, native_version, \
     native_child_session_id, checkpoint_id, created_at, updated_at";

pub(super) fn insert_fork_operation_row(
    conn: &rusqlite::Connection,
    record: &ForkOperationRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO fork_operations (
            id, idempotency_key, request_digest, parent_session_id, child_session_id,
            phase, anchor_turn_id, anchor_item_id, provider_anchor_kind,
            provider_anchor_value, provider_anchor_inclusive, prefix_terminal_seq,
            prefix_digest, adapter_version, native_version, native_child_session_id,
            checkpoint_id, created_at, updated_at
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
         )",
        params![
            record.id,
            record.idempotency_key,
            record.request_digest,
            record.parent_session_id,
            record.child_session_id,
            record.phase.as_str(),
            record.anchor_turn_id,
            record.anchor_item_id,
            record.provider_anchor_kind,
            record.provider_anchor_value,
            record.provider_anchor_inclusive.map(|value| value as i64),
            record.prefix_terminal_seq,
            record.prefix_digest,
            record.adapter_version,
            record.native_version,
            record.native_child_session_id,
            record.checkpoint_id,
            record.created_at,
            record.updated_at,
        ],
    )?;
    Ok(())
}

/// Apply the resolved provenance + native result to a fork operation row and
/// move it to `child_persisted`. Runs inside the caller's transaction so it is
/// atomic with the child session + link insert (ADR 4.4).
pub(super) fn mark_fork_operation_child_persisted_row(
    conn: &rusqlite::Connection,
    id: &str,
    result: &ForkOperationChildResult,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE fork_operations SET
            phase = 'child_persisted',
            provider_anchor_kind = ?2,
            provider_anchor_value = ?3,
            provider_anchor_inclusive = ?4,
            prefix_terminal_seq = ?5,
            prefix_digest = ?6,
            adapter_version = ?7,
            native_version = ?8,
            native_child_session_id = ?9,
            updated_at = ?10
         WHERE id = ?1",
        params![
            id,
            result.provider_anchor_kind,
            result.provider_anchor_value,
            result.provider_anchor_inclusive.map(|value| value as i64),
            result.prefix_terminal_seq,
            result.prefix_digest,
            result.adapter_version,
            result.native_version,
            result.native_child_session_id,
            now,
        ],
    )?;
    Ok(())
}

/// Resolve process-local provenance while keeping the operation `prepared`.
/// The child actor performs the only prepared -> in-flight transition later,
/// immediately before its same-process native fork request.
pub(super) fn mark_process_local_fork_child_prepared_row(
    conn: &rusqlite::Connection,
    operation_id: &str,
    child_session_id: &str,
    result: &ForkOperationChildResult,
    now: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        result.native_child_session_id.is_none(),
        "prepared process-local fork cannot have a native child id"
    );
    let changed = conn.execute(
        "UPDATE fork_operations SET
            provider_anchor_kind = ?2,
            provider_anchor_value = ?3,
            provider_anchor_inclusive = ?4,
            prefix_terminal_seq = ?5,
            prefix_digest = ?6,
            adapter_version = ?7,
            native_version = ?8,
            updated_at = ?10
         WHERE id = ?1 AND child_session_id = ?9
           AND phase = 'prepared' AND native_child_session_id IS NULL",
        params![
            operation_id,
            result.provider_anchor_kind,
            result.provider_anchor_value,
            result.provider_anchor_inclusive.map(|value| value as i64),
            result.prefix_terminal_seq,
            result.prefix_digest,
            result.adapter_version,
            result.native_version,
            child_session_id,
            now,
        ],
    )?;
    anyhow::ensure!(
        changed == 1,
        "process-local fork child preparation missed prepared operation"
    );
    Ok(())
}

pub(super) fn map_fork_operation(row: &rusqlite::Row) -> rusqlite::Result<ForkOperationRecord> {
    let phase_str: String = row.get(5)?;
    let phase = ForkOperationPhase::parse(&phase_str).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            Box::<dyn std::error::Error + Send + Sync>::from(error.to_string()),
        )
    })?;
    let provider_anchor_inclusive: Option<i64> = row.get(10)?;
    Ok(ForkOperationRecord {
        id: row.get(0)?,
        idempotency_key: row.get(1)?,
        request_digest: row.get(2)?,
        parent_session_id: row.get(3)?,
        child_session_id: row.get(4)?,
        phase,
        anchor_turn_id: row.get(6)?,
        anchor_item_id: row.get(7)?,
        provider_anchor_kind: row.get(8)?,
        provider_anchor_value: row.get(9)?,
        provider_anchor_inclusive: provider_anchor_inclusive.map(|value| value != 0),
        prefix_terminal_seq: row.get(11)?,
        prefix_digest: row.get(12)?,
        adapter_version: row.get(13)?,
        native_version: row.get(14)?,
        native_child_session_id: row.get(15)?,
        checkpoint_id: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}
