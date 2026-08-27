//! Pure schedule math for runtime-emulated loops.
//!
//! The emulated [`super::scheduler::LoopScheduler`] needs to answer one
//! question deterministically: given a [`LoopSchedule`] and a reference instant,
//! when does the loop next fire? This module owns that computation with zero
//! IO so it is exhaustively unit-testable.
//!
//! Two schedule kinds are supported:
//! - **interval** — a duration sugar (`"90s"`, `"5m"`, `"2h"`, or a bare
//!   integer number of seconds). Next fire = `after + interval`.
//! - **cron** — a standard 5-field crontab expression (minute, hour,
//!   day-of-month, month, day-of-week), evaluated in **UTC**, minute
//!   granularity. Supports `*`, `*/step`, ranges (`a-b`), `a-b/step`, and
//!   comma lists. Day-of-month / day-of-week follow Vixie-cron OR semantics
//!   when both are restricted.

use anyharness_contract::v1::{LoopSchedule, LoopScheduleKind};
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};

/// The longest window the cron walker scans before declaring a schedule
/// unsatisfiable (guards against e.g. `0 0 30 2 *` — Feb 30th).
const CRON_SCAN_LIMIT_MINUTES: i64 = 366 * 24 * 60;

/// Minimum cadence for a runtime-emulated interval loop. Native crons are
/// inherently minute-floored by cron syntax; the emulated interval path had no
/// floor, so a bare `"1"` (= 1s) would re-fire a full billable agent turn as
/// fast as each turn completed, indefinitely. Floor emulated intervals at one
/// minute to match native granularity.
pub const MIN_EMULATED_INTERVAL_MS: i64 = 60_000;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ScheduleParseError {
    #[error("interval expression is empty")]
    EmptyInterval,
    #[error("interval expression '{0}' is not a positive duration")]
    InvalidInterval(String),
    #[error("interval '{0}' fires faster than the 1-minute minimum cadence")]
    IntervalBelowFloor(String),
    #[error("cron expression must have 5 fields, got '{0}'")]
    CronFieldCount(String),
    #[error("cron field '{0}' is invalid")]
    InvalidCronField(String),
    #[error("cron expression '{0}' never fires within a year")]
    CronUnsatisfiable(String),
}

/// The next fire instant (ms since the Unix epoch) strictly after `after_ms`.
pub fn next_fire_at_ms(schedule: &LoopSchedule, after_ms: i64) -> Result<i64, ScheduleParseError> {
    match schedule.kind {
        LoopScheduleKind::Interval => {
            let interval_ms = parse_interval_ms(&schedule.expr)?;
            Ok(after_ms.saturating_add(interval_ms))
        }
        LoopScheduleKind::Cron => next_cron_fire_ms(&schedule.expr, after_ms),
    }
}

/// Parse an interval sugar into milliseconds. Accepts a trailing unit
/// (`s`/`m`/`h`/`d`) or a bare integer (seconds).
pub fn parse_interval_ms(expr: &str) -> Result<i64, ScheduleParseError> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err(ScheduleParseError::EmptyInterval);
    }
    let (value_part, unit_ms): (&str, i64) = match trimmed
        .chars()
        .last()
        .filter(|c| c.is_ascii_alphabetic())
    {
        Some('s') | Some('S') => (&trimmed[..trimmed.len() - 1], 1_000),
        Some('m') | Some('M') => (&trimmed[..trimmed.len() - 1], 60_000),
        Some('h') | Some('H') => (&trimmed[..trimmed.len() - 1], 3_600_000),
        Some('d') | Some('D') => (&trimmed[..trimmed.len() - 1], 86_400_000),
        Some(_) => return Err(ScheduleParseError::InvalidInterval(expr.to_string())),
        None => (trimmed, 1_000),
    };
    let magnitude: i64 = value_part
        .trim()
        .parse()
        .map_err(|_| ScheduleParseError::InvalidInterval(expr.to_string()))?;
    if magnitude <= 0 {
        return Err(ScheduleParseError::InvalidInterval(expr.to_string()));
    }
    magnitude
        .checked_mul(unit_ms)
        .ok_or_else(|| ScheduleParseError::InvalidInterval(expr.to_string()))
}

/// Reject a runtime-emulated schedule whose cadence is below the emulated
/// floor. Interval schedules are validated against [`MIN_EMULATED_INTERVAL_MS`];
/// cron schedules are already minute-floored by their syntax and pass through
/// unchanged (an invalid cron still surfaces its own parse error).
pub fn ensure_emulated_cadence_floor(schedule: &LoopSchedule) -> Result<(), ScheduleParseError> {
    match schedule.kind {
        LoopScheduleKind::Interval => {
            let interval_ms = parse_interval_ms(&schedule.expr)?;
            if interval_ms < MIN_EMULATED_INTERVAL_MS {
                return Err(ScheduleParseError::IntervalBelowFloor(schedule.expr.clone()));
            }
            Ok(())
        }
        LoopScheduleKind::Cron => CronExpr::parse(&schedule.expr).map(|_| ()),
    }
}

fn next_cron_fire_ms(expr: &str, after_ms: i64) -> Result<i64, ScheduleParseError> {
    let cron = CronExpr::parse(expr)?;
    let after = Utc
        .timestamp_millis_opt(after_ms)
        .single()
        .ok_or_else(|| ScheduleParseError::CronUnsatisfiable(expr.to_string()))?;

    // Strictly after: truncate to the minute, then step forward at least one
    // minute so a caller landing exactly on a matching boundary does not
    // double-fire in the same minute.
    let mut candidate = truncate_to_minute(after) + Duration::minutes(1);
    for _ in 0..CRON_SCAN_LIMIT_MINUTES {
        if cron.matches(&candidate) {
            return Ok(candidate.timestamp_millis());
        }
        candidate += Duration::minutes(1);
    }
    Err(ScheduleParseError::CronUnsatisfiable(expr.to_string()))
}

fn truncate_to_minute(dt: DateTime<Utc>) -> DateTime<Utc> {
    dt.with_second(0)
        .and_then(|dt| dt.with_nanosecond(0))
        .unwrap_or(dt)
}

/// A parsed 5-field cron expression. Each field is a set of allowed values.
struct CronExpr {
    minute: Vec<u32>,
    hour: Vec<u32>,
    day_of_month: Vec<u32>,
    month: Vec<u32>,
    day_of_week: Vec<u32>,
    dom_restricted: bool,
    dow_restricted: bool,
}

impl CronExpr {
    fn parse(expr: &str) -> Result<Self, ScheduleParseError> {
        let fields: Vec<&str> = expr.split_whitespace().collect();
        if fields.len() != 5 {
            return Err(ScheduleParseError::CronFieldCount(expr.to_string()));
        }
        let minute = parse_field(fields[0], 0, 59)?;
        let hour = parse_field(fields[1], 0, 23)?;
        let day_of_month = parse_field(fields[2], 1, 31)?;
        let month = parse_field(fields[3], 1, 12)?;
        // Cron day-of-week: 0-6 (Sun-Sat); accept 7 as Sunday too.
        let mut day_of_week = parse_field(fields[4], 0, 7)?;
        if day_of_week.contains(&7) {
            day_of_week.retain(|value| *value != 7);
            if !day_of_week.contains(&0) {
                day_of_week.push(0);
            }
        }
        Ok(Self {
            minute,
            hour,
            day_of_month,
            month,
            day_of_week,
            dom_restricted: fields[2] != "*",
            dow_restricted: fields[4] != "*",
        })
    }

    fn matches(&self, dt: &DateTime<Utc>) -> bool {
        if !self.minute.contains(&dt.minute()) || !self.hour.contains(&dt.hour()) {
            return false;
        }
        if !self.month.contains(&dt.month()) {
            return false;
        }
        // chrono weekday: Mon=0..Sun=6; cron: Sun=0..Sat=6.
        let cron_dow = (dt.weekday().num_days_from_sunday()) as u32;
        let dom_match = self.day_of_month.contains(&dt.day());
        let dow_match = self.day_of_week.contains(&cron_dow);
        match (self.dom_restricted, self.dow_restricted) {
            (true, true) => dom_match || dow_match,
            (true, false) => dom_match,
            (false, true) => dow_match,
            (false, false) => true,
        }
    }
}

/// Parse one cron field into the sorted, deduped set of allowed values.
fn parse_field(field: &str, min: u32, max: u32) -> Result<Vec<u32>, ScheduleParseError> {
    let mut values = Vec::new();
    for part in field.split(',') {
        let (range_part, step) = match part.split_once('/') {
            Some((range_part, step_part)) => {
                let step: u32 = step_part
                    .parse()
                    .map_err(|_| ScheduleParseError::InvalidCronField(field.to_string()))?;
                if step == 0 {
                    return Err(ScheduleParseError::InvalidCronField(field.to_string()));
                }
                (range_part, step)
            }
            None => (part, 1),
        };

        let (start, end) = if range_part == "*" {
            (min, max)
        } else if let Some((low, high)) = range_part.split_once('-') {
            let low: u32 = low
                .parse()
                .map_err(|_| ScheduleParseError::InvalidCronField(field.to_string()))?;
            let high: u32 = high
                .parse()
                .map_err(|_| ScheduleParseError::InvalidCronField(field.to_string()))?;
            (low, high)
        } else {
            let single: u32 = range_part
                .parse()
                .map_err(|_| ScheduleParseError::InvalidCronField(field.to_string()))?;
            (single, single)
        };

        if start < min || end > max || start > end {
            return Err(ScheduleParseError::InvalidCronField(field.to_string()));
        }
        let mut value = start;
        while value <= end {
            values.push(value);
            value += step;
        }
    }
    values.sort_unstable();
    values.dedup();
    if values.is_empty() {
        return Err(ScheduleParseError::InvalidCronField(field.to_string()));
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule(kind: LoopScheduleKind, expr: &str) -> LoopSchedule {
        LoopSchedule {
            kind,
            expr: expr.to_string(),
        }
    }

    #[test]
    fn interval_sugar_parses_units() {
        assert_eq!(parse_interval_ms("90s").unwrap(), 90_000);
        assert_eq!(parse_interval_ms("5m").unwrap(), 300_000);
        assert_eq!(parse_interval_ms("2h").unwrap(), 7_200_000);
        assert_eq!(parse_interval_ms("1d").unwrap(), 86_400_000);
        // Bare integer = seconds.
        assert_eq!(parse_interval_ms("60").unwrap(), 60_000);
    }

    #[test]
    fn interval_rejects_nonpositive_and_garbage() {
        assert!(parse_interval_ms("0s").is_err());
        assert!(parse_interval_ms("-5m").is_err());
        assert!(parse_interval_ms("abc").is_err());
        assert!(parse_interval_ms("").is_err());
    }

    #[test]
    fn emulated_cadence_floor_rejects_sub_minute_intervals() {
        // Bare integer = seconds: "1" is a 1s cadence — below the floor.
        assert_eq!(
            ensure_emulated_cadence_floor(&schedule(LoopScheduleKind::Interval, "1")),
            Err(ScheduleParseError::IntervalBelowFloor("1".to_string()))
        );
        assert!(ensure_emulated_cadence_floor(&schedule(LoopScheduleKind::Interval, "30s")).is_err());
        // Exactly at / above the 1-minute floor is allowed.
        assert!(ensure_emulated_cadence_floor(&schedule(LoopScheduleKind::Interval, "60")).is_ok());
        assert!(ensure_emulated_cadence_floor(&schedule(LoopScheduleKind::Interval, "5m")).is_ok());
        // Cron is minute-floored by syntax; a valid cron passes, invalid errors.
        assert!(ensure_emulated_cadence_floor(&schedule(LoopScheduleKind::Cron, "* * * * *")).is_ok());
        assert!(ensure_emulated_cadence_floor(&schedule(LoopScheduleKind::Cron, "nonsense")).is_err());
    }

    #[test]
    fn interval_next_fire_adds_interval() {
        let next = next_fire_at_ms(&schedule(LoopScheduleKind::Interval, "1m"), 1_000_000).unwrap();
        assert_eq!(next, 1_000_000 + 60_000);
    }

    #[test]
    fn cron_every_minute_advances_to_next_minute_boundary() {
        // 2026-01-01T00:00:30Z
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 30).unwrap();
        let next = next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "* * * * *"), base.timestamp_millis())
            .unwrap();
        let expected = Utc.with_ymd_and_hms(2026, 1, 1, 0, 1, 0).unwrap();
        assert_eq!(next, expected.timestamp_millis());
    }

    #[test]
    fn cron_step_minutes_finds_next_multiple() {
        // 2026-01-01T00:02:10Z, */5 -> next is 00:05:00
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 2, 10).unwrap();
        let next = next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "*/5 * * * *"), base.timestamp_millis())
            .unwrap();
        let expected = Utc.with_ymd_and_hms(2026, 1, 1, 0, 5, 0).unwrap();
        assert_eq!(next, expected.timestamp_millis());
    }

    #[test]
    fn cron_on_boundary_advances_to_the_following_slot() {
        // Exactly on a matching minute -> strictly-after semantics move on.
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 5, 0).unwrap();
        let next = next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "*/5 * * * *"), base.timestamp_millis())
            .unwrap();
        let expected = Utc.with_ymd_and_hms(2026, 1, 1, 0, 10, 0).unwrap();
        assert_eq!(next, expected.timestamp_millis());
    }

    #[test]
    fn cron_specific_hour_and_minute() {
        // "30 9 * * *" -> 09:30 daily. From 10:00 -> next day 09:30.
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).unwrap();
        let next = next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "30 9 * * *"), base.timestamp_millis())
            .unwrap();
        let expected = Utc.with_ymd_and_hms(2026, 1, 2, 9, 30, 0).unwrap();
        assert_eq!(next, expected.timestamp_millis());
    }

    #[test]
    fn cron_rejects_bad_field_counts_and_values() {
        assert!(next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "* * * *"), 0).is_err());
        assert!(next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "99 * * * *"), 0).is_err());
    }

    #[test]
    fn cron_range_step_bounds_check() {
        // 50-70/5 in minutes field (max 59) — range end exceeds field max.
        assert!(next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "50-70/5 * * * *"), 0).is_err());
        // 20-10/5 reversed range in minutes — start > end.
        assert!(next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "20-10/5 * * * *"), 0).is_err());
        // 10-20/5 valid range-step in minutes.
        assert!(next_fire_at_ms(&schedule(LoopScheduleKind::Cron, "10-20/5 * * * *"), 0).is_ok());
    }
}
