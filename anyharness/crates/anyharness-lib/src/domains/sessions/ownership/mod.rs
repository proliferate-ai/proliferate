//! Ownership, promotion and close attribution over `session_links`.
//!
//! One row is one ownership fact, so there is no registry and no second table:
//! the three states an agent can be in are read off the columns the ownership
//! migration added.
//!
//! | state | row |
//! | --- | --- |
//! | linked subagent | `relation = 'subagent'`, `promoted_at IS NULL` |
//! | promoted | `relation = 'subagent'`, `promoted_at IS NOT NULL` |
//! | owned agent | `relation = 'owned_agent'` |
//!
//! Ownership is deliberately NOT part of
//! [`crate::domains::sessions::authorize`]. That funnel answers reachability —
//! runtime-wide, unowned, "may this agent be messaged or read" — and every peer
//! tool clears it. Close and promote ACT ON a session rather than putting an
//! item in its inbox, so they resolve an ownership ROW first, the same way
//! `send_subagent_message` resolves a link before it touches a child.

pub mod hooks;
pub mod service;
