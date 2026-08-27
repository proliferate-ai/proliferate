//! Agent auth, the runtime half: the applied route-auth state, credential
//! detection and login, the launch probe engine, and the per-harness status
//! document. Moved out of `domains/agents/` by the Wave-3 consolidation
//! (agent_auth system spec §0) — move-only, no behavior change.

pub mod auth;
pub mod launch_probe;
pub mod route_auth;
pub mod status;
