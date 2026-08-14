//! The R4 half of the archive test split.
//!
//! The R2-vs-R4 boundary is explicit: R2 owns the pure-git round-trip, refusal,
//! and GC state matrix against SYNTHETIC `QuiesceReport`s, and R4 owns every
//! assertion that needs the orchestrator, a live process, or a real workspace
//! row. Duplicating R2's synthetic-report coverage here would only mean two
//! places to update when a git verb changes.

mod harness;

mod admission;
mod branches;
mod head_mismatch;
mod idempotency;
mod paths;
mod quiesce;
mod restore_interlocks;
mod scenarios;
mod sweep;
mod undo;
