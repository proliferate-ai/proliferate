//! Cross-resource application boundary for agent-initiated runtime operations.
//!
//! MCP and HTTP adapters authenticate callers and enter here. This module owns
//! policy and orchestration only; sessions, links, workspaces, and catalogs
//! retain their own durable truth and effects.

pub mod mcp;
pub mod model;
pub mod product_context;
pub mod runtime;
pub mod subagents;
