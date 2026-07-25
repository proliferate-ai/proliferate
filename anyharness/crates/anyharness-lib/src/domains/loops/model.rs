use anyharness_contract::v1::{Loop, LoopSchedule, LoopScheduleKind, LoopStatus};

/// The loop mirror row (spec §2.7). `native` rows mirror sidecar cron state
/// (`native_loop_id` is the sidecar's id); emulated rows are runtime-owned.
#[derive(Debug, Clone)]
pub struct LoopRecord {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub prompt: String,
    pub schedule_kind: LoopScheduleKind,
    pub schedule_expr: String,
    pub recurring: bool,
    pub status: LoopStatus,
    pub native: bool,
    pub native_loop_id: Option<String>,
    pub last_fired_at: Option<String>,
    pub next_fire_at: Option<String>,
    pub fire_count: i64,
    pub max_fires: Option<i64>,
    pub max_wall_secs: Option<i64>,
    pub source_kind: String,
    pub cleared_reason: Option<String>,
    /// Raw native payload (the last ingested `LoopWire`); empty for
    /// emulated loops.
    pub native_state_json: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Caps + provenance recorded by a runtime write before the LoopPort ext
/// call; matched to the mirrored row by prompt on `loop_updated` ingest.
#[derive(Debug, Clone, Default)]
pub struct LoopWriteIntent {
    pub prompt: String,
    pub source_kind: String,
    pub source_run_id: Option<String>,
    pub max_fires: Option<i64>,
    pub max_wall_secs: Option<i64>,
}

pub fn loop_to_contract(record: &LoopRecord) -> Loop {
    Loop {
        id: record.id.clone(),
        workspace_id: record.workspace_id.clone(),
        session_id: record.session_id.clone(),
        prompt: record.prompt.clone(),
        schedule: LoopSchedule {
            kind: record.schedule_kind,
            expr: record.schedule_expr.clone(),
        },
        recurring: record.recurring,
        status: record.status,
        native: record.native,
        last_fired_at: record.last_fired_at.clone(),
        next_fire_at: record.next_fire_at.clone(),
        fire_count: record.fire_count,
        max_fires: record.max_fires,
        max_wall_secs: record.max_wall_secs,
        source_kind: record.source_kind.clone(),
        cleared_reason: record.cleared_reason.clone(),
        revision: record.revision,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
    }
}

/// Parse an interval schedule expression (`"30s"`, `"5m"`, `"2h"`, `"1d"`,
/// or bare seconds) into a duration. Used by the emulated scheduler; native
/// loops pass their expression through to the harness untouched.
pub fn parse_interval_expr(expr: &str) -> Option<std::time::Duration> {
    let expr = expr.trim();
    if expr.is_empty() {
        return None;
    }
    let (value, unit_secs) = match expr.char_indices().last() {
        Some((index, 's')) => (&expr[..index], 1u64),
        Some((index, 'm')) => (&expr[..index], 60),
        Some((index, 'h')) => (&expr[..index], 3600),
        Some((index, 'd')) => (&expr[..index], 86400),
        Some((_, digit)) if digit.is_ascii_digit() => (expr, 1),
        _ => return None,
    };
    let value: u64 = value.trim().parse().ok()?;
    (value > 0).then(|| std::time::Duration::from_secs(value * unit_secs))
}

#[cfg(test)]
mod tests {
    use super::parse_interval_expr;
    use std::time::Duration;

    #[test]
    fn interval_expressions_parse_with_unit_suffixes() {
        assert_eq!(parse_interval_expr("30s"), Some(Duration::from_secs(30)));
        assert_eq!(parse_interval_expr("5m"), Some(Duration::from_secs(300)));
        assert_eq!(parse_interval_expr("2h"), Some(Duration::from_secs(7200)));
        assert_eq!(parse_interval_expr("1d"), Some(Duration::from_secs(86400)));
        assert_eq!(parse_interval_expr("90"), Some(Duration::from_secs(90)));
    }

    #[test]
    fn interval_expressions_reject_zero_and_garbage() {
        assert_eq!(parse_interval_expr("0m"), None);
        assert_eq!(parse_interval_expr(""), None);
        assert_eq!(parse_interval_expr("abc"), None);
        assert_eq!(parse_interval_expr("*/5 * * * *"), None);
    }
}
