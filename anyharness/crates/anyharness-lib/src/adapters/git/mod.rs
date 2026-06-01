mod default_branch;
pub mod executor;
pub mod file_search;
pub mod operations;
pub mod parse_status;
pub mod service;
pub mod types;

pub use file_search::WorkspaceFileSearchCache;
pub use service::GitService;

#[cfg(test)]
mod diff_tests;
#[cfg(test)]
mod service_tests;
