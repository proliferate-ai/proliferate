//! Runtime-local seat rotation state (agent_auth spec §4 cell 2, "Rotation
//! ownership"): per-seat cooling records observed from live limit errors, and
//! the last seat actually served per harness. The server never picks seats; it
//! only supplies the pool — this module is where the runtime's half of that
//! contract persists.

mod store;

pub use store::SeatCoolingStore;

/// Seconds in one 5-hour window.
const FIVE_HOURS_S: i64 = 5 * 60 * 60;

/// The cooling deadline used when a classified limit error carries no parseable
/// reset time: **the top of the next 5-hour window**, defined as the next UTC
/// instant that is a whole multiple of 5 hours since the Unix epoch. Claude.ai
/// usage windows are 5 hours long; absent the provider's own reset we assume
/// the current window ends at the next such boundary rather than guessing a
/// relative offset, so a burst of limit errors in one window all converge on
/// the same deadline.
pub fn next_five_hour_window_top(now_epoch_s: i64) -> i64 {
    (now_epoch_s.div_euclid(FIVE_HOURS_S) + 1) * FIVE_HOURS_S
}

#[cfg(test)]
mod tests {
    use super::next_five_hour_window_top;

    #[test]
    fn window_top_is_the_next_whole_multiple_of_five_hours() {
        // 1756220400 = 2026-08-26T15:00:00Z-ish; any epoch works — the rule is
        // arithmetic, not calendrical.
        assert_eq!(next_five_hour_window_top(0), 18_000);
        assert_eq!(next_five_hour_window_top(1), 18_000);
        assert_eq!(next_five_hour_window_top(17_999), 18_000);
        // An exact boundary rolls to the NEXT window (a limit error at the
        // boundary belongs to the window that just began).
        assert_eq!(next_five_hour_window_top(18_000), 36_000);
        assert_eq!(next_five_hour_window_top(1_756_220_400), 1_756_224_000);
    }
}
