//! The launch-refusal vocabulary (agent_auth spec §3 flow 3): every way a
//! session launch can be refused on auth grounds, with the plain-words copy a
//! human sees. "Refusals speak plain words" — a bare error code never reaches
//! a person, so the copy lives here, beside the type, pinned by test.
//!
//! `NoConfiguredSource` has no live producer this slice — zero rows in the
//! document still mean native (the zero-rows cutover is a later slice) — but
//! the vocabulary, copy, and rendering ship now so the cutover is a producer
//! change, not a vocabulary change.

use crate::domains::agents::model::AgentKind;

use super::RouteAuthError;

/// The words used for a `SourceUnsatisfied` refusal when the document carried
/// no `unsatisfied_reason`: the cause *family*, because fabricating certainty
/// about WHICH cause emptied the sources would be a lie.
pub const UNSATISFIED_FAMILY_REASON: &str =
    "its seat or key may have been revoked, or the credits behind it ran out";

/// A typed auth launch refusal. Data only — `copy()` is the one place the
/// human sentence is produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchRefusal {
    NoConfiguredSource {
        harness: String,
    },
    SourceUnsatisfied {
        harness: String,
        reason: String,
    },
    SeatCooling {
        /// The vault seat uuid — never token material.
        seat: String,
        reset_at_epoch_s: i64,
    },
    AllSeatsCooling {
        earliest_reset_epoch_s: i64,
    },
}

impl LaunchRefusal {
    /// The plain-words sentence for this refusal. Exhaustive on purpose — a
    /// new refusal variant must fail to compile here until it has copy.
    pub fn copy(&self) -> String {
        match self {
            Self::NoConfiguredSource { harness } => {
                let display = AgentKind::parse(harness)
                    .map(|kind| kind.display_name())
                    .unwrap_or(harness.as_str());
                format!("{display} isn't set up — pick a method in Settings.")
            }
            Self::SourceUnsatisfied { harness, reason } => format!(
                "The auth method selected for {harness} can't be used right now — {reason}. \
                 Pick or fix a method in Settings → Agents."
            ),
            Self::SeatCooling {
                seat: _,
                reset_at_epoch_s,
            } => seat_cooling_copy(*reset_at_epoch_s),
            Self::AllSeatsCooling {
                earliest_reset_epoch_s,
            } => all_seats_cooling_copy(*earliest_reset_epoch_s),
        }
    }

    /// The stable machine code carried beside the copy.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoConfiguredSource { .. } => "AGENT_AUTH_NOT_CONFIGURED",
            Self::SourceUnsatisfied { .. } => "AGENT_ROUTE_SELECTION_MISSING",
            Self::SeatCooling { .. } => "AGENT_ROUTE_SEAT_COOLING",
            Self::AllSeatsCooling { .. } => "AGENT_ROUTE_ALL_SEATS_COOLING",
        }
    }

    /// Map a [`RouteAuthError`] onto the refusal vocabulary where one exists:
    /// `SelectionMissing` is a `SourceUnsatisfied` (the carried
    /// `unsatisfied_reason`, else the family words), and the two cooling
    /// variants map 1:1. Every other variant is a shape/IO problem, not a
    /// refusal — `None`.
    pub fn from_route_auth_error(error: &RouteAuthError) -> Option<LaunchRefusal> {
        match error {
            RouteAuthError::SelectionMissing {
                harness_kind,
                reason,
                ..
            } => Some(Self::SourceUnsatisfied {
                harness: harness_kind.clone(),
                reason: reason
                    .clone()
                    .unwrap_or_else(|| UNSATISFIED_FAMILY_REASON.to_string()),
            }),
            RouteAuthError::SeatCooling {
                seat_id,
                reset_at_epoch_s,
                ..
            } => Some(Self::SeatCooling {
                seat: seat_id.clone(),
                reset_at_epoch_s: *reset_at_epoch_s,
            }),
            RouteAuthError::AllSeatsCooling {
                earliest_reset_epoch_s,
                ..
            } => Some(Self::AllSeatsCooling {
                earliest_reset_epoch_s: *earliest_reset_epoch_s,
            }),
            RouteAuthError::MalformedStateFile { .. }
            | RouteAuthError::StaleStateRevision { .. }
            | RouteAuthError::SelectionIncomplete { .. }
            | RouteAuthError::UnsupportedRoute { .. }
            | RouteAuthError::UnknownHarness { .. }
            | RouteAuthError::Materialize { .. } => None,
        }
    }
}

/// The `SeatCooling` sentence — one producer, shared by [`LaunchRefusal::copy`]
/// and `RouteAuthError::SeatCooling`'s Display so the words cannot drift.
pub(crate) fn seat_cooling_copy(reset_at_epoch_s: i64) -> String {
    format!(
        "This Claude.ai login hit its usage limit — it resets at {}. \
         Rotation is off, so launches wait for this login.",
        format_reset_time(reset_at_epoch_s)
    )
}

/// The `AllSeatsCooling` sentence — same single-producer rule as
/// [`seat_cooling_copy`].
pub(crate) fn all_seats_cooling_copy(earliest_reset_epoch_s: i64) -> String {
    format!(
        "All Claude.ai logins hit their usage limits — the earliest resets at {}.",
        format_reset_time(earliest_reset_epoch_s)
    )
}

/// Format a reset instant for refusal copy, in the machine's LOCAL time:
/// same local day as now → "3:05 PM"; a different day → "Aug 27, 3:05 PM".
pub(crate) fn format_reset_time(reset_epoch_s: i64) -> String {
    format_reset_time_in(reset_epoch_s, chrono::Utc::now().timestamp(), &chrono::Local)
}

/// The injectable core of [`format_reset_time`]: `now` and the timezone are
/// parameters so tests are deterministic on any machine. Formatting is
/// assembled by hand (fixed English month names, unpadded 12-hour clock)
/// rather than strftime, so the copy cannot drift with locale.
fn format_reset_time_in<Tz: chrono::TimeZone>(
    reset_epoch_s: i64,
    now_epoch_s: i64,
    tz: &Tz,
) -> String {
    use chrono::{Datelike, Timelike};
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let reset = tz.timestamp_opt(reset_epoch_s, 0).single();
    let now = tz.timestamp_opt(now_epoch_s, 0).single();
    let (Some(reset), Some(now)) = (reset, now) else {
        // Out-of-range epoch: fall back to the raw value rather than panic.
        return format!("epoch {reset_epoch_s}");
    };
    let hour = reset.hour();
    let hour12 = match hour % 12 {
        0 => 12,
        h => h,
    };
    let am_pm = if hour < 12 { "AM" } else { "PM" };
    let clock = format!("{hour12}:{:02} {am_pm}", reset.minute());
    if reset.date_naive() == now.date_naive() {
        clock
    } else {
        format!(
            "{} {}, {clock}",
            MONTHS[reset.month0() as usize],
            reset.day()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_day_formats_clock_only_and_other_day_names_the_date() {
        let utc = chrono::Utc;
        // 2026-08-26T15:05:00Z vs now 2026-08-26T14:00:00Z (same UTC day).
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-26T14:00:00Z")
            .unwrap()
            .timestamp();
        let same_day = chrono::DateTime::parse_from_rfc3339("2026-08-26T15:05:00Z")
            .unwrap()
            .timestamp();
        assert_eq!(format_reset_time_in(same_day, now, &utc), "3:05 PM");

        // Next day → the date appears.
        let next_day = chrono::DateTime::parse_from_rfc3339("2026-08-27T15:05:00Z")
            .unwrap()
            .timestamp();
        assert_eq!(format_reset_time_in(next_day, now, &utc), "Aug 27, 3:05 PM");
    }

    #[test]
    fn midnight_and_noon_render_as_twelve() {
        let utc = chrono::Utc;
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-27T01:00:00Z")
            .unwrap()
            .timestamp();
        let midnight = chrono::DateTime::parse_from_rfc3339("2026-08-27T00:00:00Z")
            .unwrap()
            .timestamp();
        assert_eq!(format_reset_time_in(midnight, now, &utc), "12:00 AM");
        let noon = chrono::DateTime::parse_from_rfc3339("2026-08-27T12:30:00Z")
            .unwrap()
            .timestamp();
        assert_eq!(format_reset_time_in(noon, now, &utc), "12:30 PM");
    }

    #[test]
    fn the_day_boundary_follows_the_injected_timezone_not_utc() {
        // 2026-08-26T20:00:00Z is already Aug 27 in UTC+5:30 — the same
        // instant crosses the day boundary depending on the zone, so the
        // helper must judge "same day" in the caller's zone.
        let ist = chrono::FixedOffset::east_opt(5 * 3600 + 30 * 60).unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-26T10:00:00Z")
            .unwrap()
            .timestamp();
        let evening_utc = chrono::DateTime::parse_from_rfc3339("2026-08-26T20:00:00Z")
            .unwrap()
            .timestamp();
        // In UTC these are the same day...
        assert_eq!(format_reset_time_in(evening_utc, now, &chrono::Utc), "8:00 PM");
        // ...in IST the reset is already tomorrow (01:30 AM, Aug 27).
        assert_eq!(
            format_reset_time_in(evening_utc, now, &ist),
            "Aug 27, 1:30 AM"
        );
    }
}
