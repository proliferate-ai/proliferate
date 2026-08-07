//! Re-export shim.
//!
//! `LinkCompletionStore` and its row types physically live in
//! `domains/sessions/store/link_completions.rs` (grid plan PR 5b): the SQL
//! for `session_link_completions` / `session_link_wake_schedules` is store
//! code, and `in_domain_store()` only recognizes `store.rs` and `store/**`.
//! This shim keeps every existing caller's import path
//! (`crate::domains::sessions::links::completions::..`) working unchanged.
pub use crate::domains::sessions::store::link_completions::{
    LinkCompletionInsert, LinkCompletionRecord, LinkCompletionStore, LinkWakeScheduleRecord,
};
