//! The archive feature's dark-by-construction skeleton. `archive.rs`,
//! `unarchive.rs`, `quiesce.rs`, and `sweep.rs` arrive in R4; this rung ships
//! only the `refs/proliferate/archive-*` namespace's sole writer.

pub mod refs;

#[cfg(test)]
mod refs_tests;
