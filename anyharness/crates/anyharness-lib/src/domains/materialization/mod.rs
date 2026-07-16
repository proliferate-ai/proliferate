pub(crate) mod acquire;
pub mod identity;
pub mod model;
pub(crate) mod operation_lock;
pub mod service;
pub mod store;

#[cfg(test)]
mod service_git_tests;
#[cfg(test)]
mod tests;
