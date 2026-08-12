//! PR 5 parent side of the protected child diagnostics bridge.
//!
//! Each submodule self-gates to supported macOS targets, so unsupported Unix
//! and non-Unix builds compile these declarations to empty modules and expose
//! no Unix bridge types.

pub(crate) mod bootstrap;
pub(crate) mod fallback_root;
pub(crate) mod launch;
pub(crate) mod native_image;
pub(crate) mod reader;
pub(crate) mod reap;
pub(crate) mod runtime;
