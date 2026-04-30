mod branch_base;
mod default_branch;
mod diff;
pub mod executor;
pub mod file_search;
pub mod mobility_delta;
pub mod parse_status;
pub mod service;
pub mod types;

pub use file_search::WorkspaceFileSearchCache;
pub use service::GitService;

#[cfg(test)]
mod diff_tests;
