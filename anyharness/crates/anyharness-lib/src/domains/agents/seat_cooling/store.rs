//! SQLite-backed store for seat cooling + rotation rows (migration
//! `0077_seat_cooling`). Pattern-matched on the launch-options store, with one
//! deliberate difference: **no operation here ever surfaces an error**.
//! Rotation must never brick a launch — a locked or unreadable database
//! degrades to "no cooling knowledge" (serve as if nothing cools, advance
//! nothing) with a `tracing::warn`, because the worst outcome of missing
//! cooling data is one refused provider call, while the worst outcome of a
//! hard error here is a machine that cannot launch anything at all.
//!
//! Seat ids are vault uuids — never token material — so every value this store
//! reads or writes is log-safe.

use rusqlite::{params, OptionalExtension};

use crate::persistence::Db;

#[derive(Clone)]
pub struct SeatCoolingStore {
    db: Db,
}

impl SeatCoolingStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// Record (or extend) a seat's cooling deadline. Two rules, applied here
    /// because this is the one door every writer passes through:
    ///
    /// 1. **Clamp** — the deadline is bounded to `now + 7 days`
    ///    ([`super::clamp_cooling_deadline`]): a provider epoch is
    ///    shape-checked text, and nothing else ever shortens a row.
    /// 2. **Never shorten** — an existing UNEXPIRED deadline later than the
    ///    new one wins (`max(existing_unexpired, new)`), keeping its window
    ///    label. A weekly limit observed with a parseable reset is therefore
    ///    not cut back to the next 5-hour top by a later prose-only
    ///    observation (the `None`-reset fallback) — a seat that is out for the
    ///    week stays out for the week. An expired row is replaced outright.
    ///
    /// `observed_at_epoch_s` always records the newest observation.
    pub fn mark_cooling(
        &self,
        seat_id: &str,
        harness_kind: &str,
        cooling_until_epoch_s: i64,
        window: Option<&str>,
        now_epoch_s: i64,
    ) {
        let cooling_until_epoch_s = super::clamp_cooling_deadline(now_epoch_s, cooling_until_epoch_s);
        let result = self.db.with_conn(|conn| {
            // `seat_cooling.*` in the DO UPDATE arm is the pre-update row, so
            // the two CASEs judge the same existing deadline.
            conn.execute(
                "INSERT INTO seat_cooling (
                    seat_id, harness_kind, cooling_until_epoch_s, window, observed_at_epoch_s
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(seat_id) DO UPDATE SET
                    harness_kind = excluded.harness_kind,
                    cooling_until_epoch_s = CASE
                        WHEN seat_cooling.cooling_until_epoch_s > excluded.observed_at_epoch_s
                         AND seat_cooling.cooling_until_epoch_s > excluded.cooling_until_epoch_s
                        THEN seat_cooling.cooling_until_epoch_s
                        ELSE excluded.cooling_until_epoch_s END,
                    window = CASE
                        WHEN seat_cooling.cooling_until_epoch_s > excluded.observed_at_epoch_s
                         AND seat_cooling.cooling_until_epoch_s > excluded.cooling_until_epoch_s
                        THEN seat_cooling.window
                        ELSE excluded.window END,
                    observed_at_epoch_s = excluded.observed_at_epoch_s",
                params![seat_id, harness_kind, cooling_until_epoch_s, window, now_epoch_s],
            )
        });
        if let Err(error) = result {
            tracing::warn!(seat_id, harness_kind, %error, "failed to persist seat cooling record");
        }
    }

    /// The seat's cooling deadline, if it is still in the future. Expired rows
    /// read as not-cooling and are pruned lazily on the way out.
    pub fn cooling_until(&self, seat_id: &str, now_epoch_s: i64) -> Option<i64> {
        self.prune_expired(now_epoch_s);
        let result = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT cooling_until_epoch_s FROM seat_cooling
                 WHERE seat_id = ?1 AND cooling_until_epoch_s > ?2",
                params![seat_id, now_epoch_s],
                |row| row.get::<_, i64>(0),
            )
            .optional()
        });
        match result {
            Ok(until) => until,
            Err(error) => {
                tracing::warn!(seat_id, %error, "failed to read seat cooling record; treating as not cooling");
                None
            }
        }
    }

    /// Every still-cooling seat for a harness: seat_id → cooling_until. Expired
    /// rows are excluded (and pruned lazily).
    pub fn cooling_map(
        &self,
        harness_kind: &str,
        now_epoch_s: i64,
    ) -> std::collections::BTreeMap<String, i64> {
        self.prune_expired(now_epoch_s);
        let result = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT seat_id, cooling_until_epoch_s FROM seat_cooling
                 WHERE harness_kind = ?1 AND cooling_until_epoch_s > ?2",
            )?;
            let rows = stmt.query_map(params![harness_kind, now_epoch_s], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?;
            rows.collect::<rusqlite::Result<std::collections::BTreeMap<String, i64>>>()
        });
        match result {
            Ok(map) => map,
            Err(error) => {
                tracing::warn!(harness_kind, %error, "failed to read seat cooling map; treating as no cooling knowledge");
                std::collections::BTreeMap::new()
            }
        }
    }

    /// The seat that last actually served a launch for this harness, if any.
    pub fn last_served(&self, harness_kind: &str) -> Option<String> {
        let result = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT last_served_seat_id FROM seat_rotation WHERE harness_kind = ?1",
                [harness_kind],
                |row| row.get::<_, String>(0),
            )
            .optional()
        });
        match result {
            Ok(seat) => seat,
            Err(error) => {
                tracing::warn!(harness_kind, %error, "failed to read last-served seat; treating as none");
                None
            }
        }
    }

    /// Record that a seat actually served a launch (called ONLY on a
    /// successful spawn — never at render/preview time, which is what keeps
    /// round-robin from advancing on failed or previewed launches).
    pub fn confirm_served(&self, harness_kind: &str, seat_id: &str, now_epoch_s: i64) {
        let result = self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO seat_rotation (harness_kind, last_served_seat_id, updated_at_epoch_s)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(harness_kind) DO UPDATE SET
                    last_served_seat_id = excluded.last_served_seat_id,
                    updated_at_epoch_s = excluded.updated_at_epoch_s",
                params![harness_kind, seat_id, now_epoch_s],
            )
        });
        if let Err(error) = result {
            tracing::warn!(harness_kind, seat_id, %error, "failed to record served seat");
        }
    }

    /// Lazy pruning: expired cooling rows carry no information a read cares
    /// about, so any read sweeps them. Failure is ignored beyond a warn — the
    /// read queries above filter on the deadline themselves.
    fn prune_expired(&self, now_epoch_s: i64) {
        let result = self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM seat_cooling WHERE cooling_until_epoch_s <= ?1",
                [now_epoch_s],
            )
        });
        if let Err(error) = result {
            tracing::warn!(%error, "failed to prune expired seat cooling rows");
        }
    }
}
