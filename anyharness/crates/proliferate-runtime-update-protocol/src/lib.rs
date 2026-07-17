//! Frozen wire contract for the Supervisor-owned runtime update mailbox.
//!
//! The Worker (write side) and the Supervisor (consume side) exchange update
//! intent through JSON files in the sandbox mailbox directory
//! `.proliferate/supervisor/updates`. This crate is the ONLY code shared
//! between the two target binaries: it owns the request/result shapes, their
//! path-safety validation, the atomic file IO, and the filename conventions.
//!
//! Ownership boundary (see `specs/codebase/structures/proliferate-supervisor`):
//! the Supervisor must never depend on Worker internals, and the Worker must
//! not gain any Supervisor internals. A small shared protocol crate — depended
//! on by *both* — is the clean way to make the two sides agree on one wire
//! shape without either importing the other. Neither the request nor the
//! result carries behavior; activation policy lives entirely in the Supervisor.
//!
//! The crate is split into `types` (the wire shapes), `validation` (fail-closed
//! admission), and `io` (filenames + atomic file IO), all re-exported flat so
//! consumers use `proliferate_runtime_update_protocol::write_request` etc.
//!
//! Flow (frozen contract):
//! ```text
//! Worker observes divergence -> write_request() (atomic, idempotent by name)
//!   -> Supervisor list_request_files() -> read_request() (validated)
//!   -> verify/download/re-verify/stage/activate/health-gate
//!   -> Supervisor write_result() -> Worker read_result() -> heartbeat converged
//! ```

use std::path::PathBuf;

use thiserror::Error;

mod io;
mod types;
mod validation;

pub use io::{
    list_request_files, read_request, read_result, request_file_name, result_exists,
    result_file_name, write_request, write_result,
};
pub use types::{UpdateComponent, UpdateOutcome, UpdateRequestV1, UpdateResultV1};
pub use validation::{validate_request, validate_result};

/// Wire schema version. Encoded in the type names (`*V1`) and in the on-disk
/// filenames. A breaking change introduces `UpdateRequestV2` + a new filename
/// prefix rather than mutating these shapes in place, so a straddling
/// worker/supervisor pair never silently misreads a foreign schema.
pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid update mailbox field {field}: {value}")]
    InvalidField { field: &'static str, value: String },
    #[error("failed to serialize update mailbox json")]
    Serialize(#[source] serde_json::Error),
    #[error("failed to parse update mailbox json at {path}")]
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("failed to read update mailbox file at {path}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to write update mailbox file at {path}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to create update mailbox directory at {path}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to set private permissions on {path}")]
    SetPermissions {
        path: PathBuf,
        source: std::io::Error,
    },
}
