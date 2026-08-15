#[cfg(unix)]
pub mod client;
#[cfg(not(unix))]
#[path = "client_unsupported.rs"]
pub mod client;
#[cfg(unix)]
pub(crate) mod discovery;
pub mod protocol;
#[cfg(unix)]
pub(crate) mod server;
#[cfg(not(unix))]
#[path = "server_unsupported.rs"]
pub(crate) mod server;
