mod branch_base;
mod default_branch;
mod diff;
pub mod executor;
pub mod file_search;
mod operation;
pub mod parse_status;
mod revert_patches;
pub mod service;
pub mod types;

pub use file_search::WorkspaceFileSearchCache;
pub use service::GitService;

#[cfg(test)]
mod diff_tests;
#[cfg(test)]
mod service_tests;
