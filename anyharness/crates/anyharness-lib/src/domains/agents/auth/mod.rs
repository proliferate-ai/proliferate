//! Agent auth: local credential detection, pure auth-context
//! classification, and interactive login. One concern, one service surface.

pub mod context;
pub mod credentials;
pub mod launch_facts;
pub mod login;
pub mod login_terminal;

#[cfg(test)]
mod context_tests;
