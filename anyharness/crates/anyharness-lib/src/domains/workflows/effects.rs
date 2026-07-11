//! The per-effect durable ledger + the pure crash-recovery decision matrix
//! (WS5b, feature spec §6.5 attempts/effects/crash recovery, plan §7.3).
//!
//! The ledger row is written BEFORE an externally meaningful action begins, so
//! a crash between intent and terminal status is a *reconcilable* boundary
//! rather than a blind repeat. The recovery decision functions here are pure —
//! they take the persisted effect row plus whatever the runtime could prove
//! about the external world (a durable result, a live process, a queried PR/
//! receipt) and return the one recovery action the matrix mandates (plan §7.3).
//! The live layer supplies the probes; the domain owns the policy. Each
//! `recover_*` fn documents its own matrix row; the deterministic action
//! handshake (submit/wait/result) lives in [`super::action`].

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::engine::StepOutcome;

/// The replay class of an externally meaningful effect (spec §6.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectKind {
    AgentTurn,
    Shell,
    Scm,
    Action,
    Gateway,
}

impl EffectKind {
    pub fn as_db(self) -> &'static str {
        match self {
            EffectKind::AgentTurn => "agent_turn",
            EffectKind::Shell => "shell",
            EffectKind::Scm => "scm",
            EffectKind::Action => "action",
            EffectKind::Gateway => "gateway",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "agent_turn" => EffectKind::AgentTurn,
            "shell" => EffectKind::Shell,
            "scm" => EffectKind::Scm,
            "action" => EffectKind::Action,
            "gateway" => EffectKind::Gateway,
            _ => return None,
        })
    }

    /// The effect kind an effect-bearing plan step performs, if any. Control
    /// steps (`agent.config`, `branch`) and multi-turn kinds resolved elsewhere
    /// return `None`/their own kind as noted at the call site.
    pub fn for_step_slug(slug: &str) -> Option<Self> {
        Some(match slug {
            "agent.prompt" | "agent.emit" => EffectKind::AgentTurn,
            "shell.run" => EffectKind::Shell,
            "scm.open_pr" => EffectKind::Scm,
            "notify" => EffectKind::Action,
            _ => return None,
        })
    }
}

/// The effect lifecycle, distinct from the step status. A `Started` row with no
/// terminal status IS the crash boundary the recovery matrix reconciles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectStatus {
    Started,
    Completed,
    Failed,
    OutcomeUncertain,
}

impl EffectStatus {
    pub fn as_db(self) -> &'static str {
        match self {
            EffectStatus::Started => "started",
            EffectStatus::Completed => "completed",
            EffectStatus::Failed => "failed",
            EffectStatus::OutcomeUncertain => "outcome_uncertain",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "started" => EffectStatus::Started,
            "completed" => EffectStatus::Completed,
            "failed" => EffectStatus::Failed,
            "outcome_uncertain" => EffectStatus::OutcomeUncertain,
            _ => return None,
        })
    }
}

/// One durable per-effect ledger row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowEffectRecord {
    pub run_id: String,
    pub step_key: String,
    pub attempt: i64,
    pub effect_seq: i64,
    pub kind: EffectKind,
    pub external_identity: Option<String>,
    pub status: EffectStatus,
    pub result_json: Option<String>,
    pub replay_key: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The terminal essentials of the [`StepOutcome`] an effect produced, stored in
/// `result_json` so a reconcile reproduces exactly what the step would have
/// returned — never a second external effect. Only the three terminal effect
/// outcomes are representable; control outcomes (`AwaitApproval`, `EndRun`) are
/// never effects.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum EffectResult {
    Completed {
        output: serde_json::Value,
    },
    Failed {
        code: String,
        message: Option<String>,
        output: Option<serde_json::Value>,
    },
    OutcomeUncertain {
        effect: String,
        detail: Option<String>,
    },
}

impl EffectResult {
    /// The durable-result view of a terminal effect outcome. `None` for the
    /// control outcomes that are never effects.
    pub fn from_outcome(outcome: &StepOutcome) -> Option<Self> {
        match outcome {
            StepOutcome::Completed { output } => Some(EffectResult::Completed {
                output: output.clone(),
            }),
            StepOutcome::Failed {
                code,
                message,
                output,
            } => Some(EffectResult::Failed {
                code: code.clone(),
                message: message.clone(),
                output: output.clone(),
            }),
            StepOutcome::OutcomeUncertain { effect, detail } => {
                Some(EffectResult::OutcomeUncertain {
                    effect: effect.clone(),
                    detail: detail.clone(),
                })
            }
            StepOutcome::AwaitApproval { .. } | StepOutcome::EndRun { .. } => None,
        }
    }

    /// Rebuild the [`StepOutcome`] a reconcile returns.
    pub fn into_outcome(self) -> StepOutcome {
        match self {
            EffectResult::Completed { output } => StepOutcome::Completed { output },
            EffectResult::Failed {
                code,
                message,
                output,
            } => StepOutcome::Failed {
                code,
                message,
                output,
            },
            EffectResult::OutcomeUncertain { effect, detail } => {
                StepOutcome::OutcomeUncertain { effect, detail }
            }
        }
    }

    /// The terminal `EffectStatus` this result records.
    pub fn status(&self) -> EffectStatus {
        match self {
            EffectResult::Completed { .. } => EffectStatus::Completed,
            EffectResult::Failed { .. } => EffectStatus::Failed,
            EffectResult::OutcomeUncertain { .. } => EffectStatus::OutcomeUncertain,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

/// The recovery action for a crash-boundary effect (plan §7.3 matrix).
#[derive(Debug, Clone, PartialEq)]
pub enum EffectRecovery {
    /// A durable terminal result was found; reconcile the step with it and
    /// never re-run the external op.
    Reconcile(EffectResult),
    /// The persisted process group is still alive; reattach and wait/stop it.
    AwaitProcess,
    /// Safe to replay the effect fresh — an idempotent shell replay key, an SCM
    /// reissue by the identical branch identity, or an effect that never
    /// actually started.
    Replay,
    /// The outcome is unprovable; uncertainty is terminal for the attempt and
    /// is never blindly replayed.
    Uncertain,
}

/// Reconcile straight from the effect's own persisted `result_json`; a terminal
/// effect with no stored result is unprovable → `Uncertain`.
fn reconcile_from(effect: &WorkflowEffectRecord) -> EffectRecovery {
    match effect
        .result_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<EffectResult>(raw).ok())
    {
        Some(result) => EffectRecovery::Reconcile(result),
        None => EffectRecovery::Uncertain,
    }
}

/// Agent-turn recovery (§7.3). A durable terminal transcript reconciles; an
/// unprovable turn stops `outcome_uncertain` — NEVER an automatic replacement
/// prompt. `durable_result` is what the harness could prove about the persisted
/// turn id; the current harness API cannot reattach, so the live layer passes
/// `None` and the honest policy is uncertain.
pub fn recover_agent_turn(
    effect: &WorkflowEffectRecord,
    durable_result: Option<EffectResult>,
) -> EffectRecovery {
    match effect.status {
        EffectStatus::Completed | EffectStatus::Failed => reconcile_from(effect),
        EffectStatus::OutcomeUncertain => EffectRecovery::Uncertain,
        EffectStatus::Started => match durable_result {
            Some(result) => EffectRecovery::Reconcile(result),
            None => EffectRecovery::Uncertain,
        },
    }
}

/// Shell recovery (§7.3). Durable exit ⇒ reconcile; a live process group ⇒
/// reattach/wait; neither ⇒ `outcome_uncertain` unless an idempotent replay key
/// is declared (then a fresh replay is safe).
pub fn recover_shell(
    effect: &WorkflowEffectRecord,
    pg_alive: bool,
    durable_exit: Option<EffectResult>,
) -> EffectRecovery {
    match effect.status {
        EffectStatus::Completed | EffectStatus::Failed => reconcile_from(effect),
        EffectStatus::OutcomeUncertain => EffectRecovery::Uncertain,
        EffectStatus::Started => {
            if let Some(result) = durable_exit {
                EffectRecovery::Reconcile(result)
            } else if pg_alive {
                EffectRecovery::AwaitProcess
            } else if effect.replay_key.is_some() {
                EffectRecovery::Replay
            } else {
                EffectRecovery::Uncertain
            }
        }
    }
}

/// SCM/open-PR recovery (§7.3). Query the persisted branch/PR identity: a match
/// reconciles; otherwise reissue with the identical branch identity (a reissue
/// never opens a second PR under a new identity).
pub fn recover_scm(
    effect: &WorkflowEffectRecord,
    pr_reconciled: Option<EffectResult>,
) -> EffectRecovery {
    match effect.status {
        EffectStatus::Completed | EffectStatus::Failed => reconcile_from(effect),
        EffectStatus::OutcomeUncertain => EffectRecovery::Uncertain,
        EffectStatus::Started => match pr_reconciled {
            Some(result) => EffectRecovery::Reconcile(result),
            None => EffectRecovery::Replay,
        },
    }
}

/// Gateway-invocation recovery (§7.3 / §7.4). Activation-keyed receipt present
/// ⇒ reconcile; missing after an unknown upstream ⇒ `outcome_uncertain` (never a
/// new activation). WS5c wires the receipt probe; the policy is frozen here.
pub fn recover_gateway(
    effect: &WorkflowEffectRecord,
    receipt: Option<EffectResult>,
) -> EffectRecovery {
    match effect.status {
        EffectStatus::Completed | EffectStatus::Failed => reconcile_from(effect),
        EffectStatus::OutcomeUncertain => EffectRecovery::Uncertain,
        EffectStatus::Started => match receipt {
            Some(result) => EffectRecovery::Reconcile(result),
            None => EffectRecovery::Uncertain,
        },
    }
}

// Durable ledger SQL. Takes `&Connection` so writes ride the caller's tx (the
// intent write must be atomic with the step state it guards), like
// `observations::append_in_tx`.

/// Persist an effect's INTENT before its external action begins. Idempotent on
/// the PK: a duplicate actor wake at the same (step_key, attempt, seq, kind)
/// keeps the existing row (which may already be terminal) instead of
/// resurrecting it as `started`.
#[allow(clippy::too_many_arguments)]
pub fn insert_started_tx(
    tx: &Connection,
    run_id: &str,
    step_key: &str,
    attempt: i64,
    effect_seq: i64,
    kind: EffectKind,
    external_identity: Option<&str>,
    replay_key: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO workflow_effects (
            run_id, step_key, attempt, effect_seq, effect_kind, external_identity,
            status, result_json, replay_key, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?9)",
        params![
            run_id,
            step_key,
            attempt,
            effect_seq,
            kind.as_db(),
            external_identity,
            EffectStatus::Started.as_db(),
            replay_key,
            now,
        ],
    )?;
    Ok(())
}

/// Stamp the external identity onto a `started` effect once the op yields it
/// (e.g. a shell's pgid after spawn, a turn id after send). No-op once terminal.
#[allow(clippy::too_many_arguments)]
pub fn set_identity_tx(
    tx: &Connection,
    run_id: &str,
    step_key: &str,
    attempt: i64,
    effect_seq: i64,
    kind: EffectKind,
    external_identity: &str,
    now: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_effects
         SET external_identity = ?6, updated_at = ?7
         WHERE run_id = ?1 AND step_key = ?2 AND attempt = ?3 AND effect_seq = ?4
           AND effect_kind = ?5 AND status = 'started'",
        params![
            run_id,
            step_key,
            attempt,
            effect_seq,
            kind.as_db(),
            external_identity,
            now,
        ],
    )?;
    Ok(())
}

/// Record an effect's terminal result (completed/failed/outcome_uncertain).
#[allow(clippy::too_many_arguments)]
pub fn mark_terminal_tx(
    tx: &Connection,
    run_id: &str,
    step_key: &str,
    attempt: i64,
    effect_seq: i64,
    kind: EffectKind,
    result: &EffectResult,
    now: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE workflow_effects
         SET status = ?6, result_json = ?7, updated_at = ?8
         WHERE run_id = ?1 AND step_key = ?2 AND attempt = ?3 AND effect_seq = ?4
           AND effect_kind = ?5",
        params![
            run_id,
            step_key,
            attempt,
            effect_seq,
            kind.as_db(),
            result.status().as_db(),
            result.to_json(),
            now,
        ],
    )?;
    Ok(())
}

/// The exact effect row at `(step_key, attempt, seq, kind)`, if any.
pub fn find_effect_tx(
    tx: &Connection,
    run_id: &str,
    step_key: &str,
    attempt: i64,
    effect_seq: i64,
    kind: EffectKind,
) -> rusqlite::Result<Option<WorkflowEffectRecord>> {
    tx.query_row(
        "SELECT * FROM workflow_effects
         WHERE run_id = ?1 AND step_key = ?2 AND attempt = ?3 AND effect_seq = ?4
           AND effect_kind = ?5",
        params![run_id, step_key, attempt, effect_seq, kind.as_db()],
        map_effect,
    )
    .optional()
}

/// The last effect a given step ATTEMPT reached (highest seq) for a kind — the
/// recovery hook reads the crashed attempt (`ctx.attempt - 1`) through this.
pub fn latest_effect_for_attempt_tx(
    tx: &Connection,
    run_id: &str,
    step_key: &str,
    attempt: i64,
    kind: EffectKind,
) -> rusqlite::Result<Option<WorkflowEffectRecord>> {
    tx.query_row(
        "SELECT * FROM workflow_effects
         WHERE run_id = ?1 AND step_key = ?2 AND attempt = ?3 AND effect_kind = ?4
         ORDER BY effect_seq DESC LIMIT 1",
        params![run_id, step_key, attempt, kind.as_db()],
        map_effect,
    )
    .optional()
}

/// Every effect row for a run, in step/attempt/seq order (tests + observability).
pub fn list_effects_tx(
    tx: &Connection,
    run_id: &str,
) -> rusqlite::Result<Vec<WorkflowEffectRecord>> {
    let mut stmt = tx.prepare(
        "SELECT * FROM workflow_effects WHERE run_id = ?1
         ORDER BY step_key ASC, attempt ASC, effect_seq ASC",
    )?;
    let rows = stmt.query_map([run_id], map_effect)?;
    rows.collect()
}

fn map_effect(row: &Row<'_>) -> rusqlite::Result<WorkflowEffectRecord> {
    let kind_raw: String = row.get("effect_kind")?;
    let kind = EffectKind::from_db(&kind_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown effect kind: {kind_raw}").into(),
        )
    })?;
    let status_raw: String = row.get("status")?;
    let status = EffectStatus::from_db(&status_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown effect status: {status_raw}").into(),
        )
    })?;
    Ok(WorkflowEffectRecord {
        run_id: row.get("run_id")?,
        step_key: row.get("step_key")?,
        attempt: row.get("attempt")?,
        effect_seq: row.get("effect_seq")?,
        kind,
        external_identity: row.get("external_identity")?,
        status,
        result_json: row.get("result_json")?,
        replay_key: row.get("replay_key")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn effect(status: EffectStatus, replay_key: Option<&str>, result: Option<EffectResult>) -> WorkflowEffectRecord {
        WorkflowEffectRecord {
            run_id: "run-1".to_string(),
            step_key: "0.-.0".to_string(),
            attempt: 1,
            effect_seq: 0,
            kind: EffectKind::Shell,
            external_identity: Some("4242".to_string()),
            status,
            result_json: result.map(|r| r.to_json()),
            replay_key: replay_key.map(str::to_string),
            created_at: "t".to_string(),
            updated_at: "t".to_string(),
        }
    }

    #[test]
    fn effect_result_round_trips_through_outcome() {
        let outcome = StepOutcome::Completed { output: json!({"pr": 7}) };
        let result = EffectResult::from_outcome(&outcome).unwrap();
        assert_eq!(result.status(), EffectStatus::Completed);
        match result.clone().into_outcome() {
            StepOutcome::Completed { output } => assert_eq!(output["pr"], 7),
            other => panic!("expected Completed, got {other:?}"),
        }
        // The serialized form is what lands in result_json and comes back byte-equal.
        let raw = result.to_json();
        assert_eq!(serde_json::from_str::<EffectResult>(&raw).unwrap(), result);
    }

    #[test]
    fn control_outcomes_are_never_effects() {
        assert!(EffectResult::from_outcome(&StepOutcome::EndRun { output: json!({}) }).is_none());
        assert!(EffectResult::from_outcome(&StepOutcome::AwaitApproval { descriptor: json!({}) }).is_none());
    }

    #[test]
    fn agent_turn_started_without_durable_result_is_uncertain_never_reprompt() {
        let eff = effect(EffectStatus::Started, None, None);
        assert_eq!(recover_agent_turn(&eff, None), EffectRecovery::Uncertain);
    }

    #[test]
    fn agent_turn_started_with_durable_transcript_reconciles() {
        let eff = effect(EffectStatus::Started, None, None);
        let result = EffectResult::Completed { output: json!({"turn": "t1"}) };
        assert_eq!(
            recover_agent_turn(&eff, Some(result.clone())),
            EffectRecovery::Reconcile(result)
        );
    }

    #[test]
    fn agent_turn_completed_reconciles_from_stored_result() {
        let result = EffectResult::Completed { output: json!({"ok": true}) };
        let eff = effect(EffectStatus::Completed, None, Some(result.clone()));
        assert_eq!(recover_agent_turn(&eff, None), EffectRecovery::Reconcile(result));
    }

    #[test]
    fn shell_started_no_proof_no_key_is_uncertain() {
        let eff = effect(EffectStatus::Started, None, None);
        assert_eq!(recover_shell(&eff, false, None), EffectRecovery::Uncertain);
    }

    #[test]
    fn shell_started_with_replay_key_replays() {
        let eff = effect(EffectStatus::Started, Some("idempotent-build"), None);
        assert_eq!(recover_shell(&eff, false, None), EffectRecovery::Replay);
    }

    #[test]
    fn shell_started_with_live_process_waits() {
        let eff = effect(EffectStatus::Started, None, None);
        assert_eq!(recover_shell(&eff, true, None), EffectRecovery::AwaitProcess);
    }

    #[test]
    fn shell_started_with_durable_exit_reconciles_over_replay_key() {
        let eff = effect(EffectStatus::Started, Some("idempotent"), None);
        let result = EffectResult::Completed { output: json!({"exit_code": 0}) };
        assert_eq!(
            recover_shell(&eff, false, Some(result.clone())),
            EffectRecovery::Reconcile(result)
        );
    }

    #[test]
    fn scm_started_without_pr_reissues_with_identical_identity() {
        let mut eff = effect(EffectStatus::Started, None, None);
        eff.kind = EffectKind::Scm;
        assert_eq!(recover_scm(&eff, None), EffectRecovery::Replay);
    }

    #[test]
    fn scm_started_with_found_pr_reconciles() {
        let mut eff = effect(EffectStatus::Started, None, None);
        eff.kind = EffectKind::Scm;
        let result = EffectResult::Completed { output: json!({"pr_url": "https://x/pull/1"}) };
        assert_eq!(recover_scm(&eff, Some(result.clone())), EffectRecovery::Reconcile(result));
    }

    #[test]
    fn gateway_started_without_receipt_is_uncertain() {
        let mut eff = effect(EffectStatus::Started, None, None);
        eff.kind = EffectKind::Gateway;
        assert_eq!(recover_gateway(&eff, None), EffectRecovery::Uncertain);
    }
}
