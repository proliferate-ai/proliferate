//! Response formatting guidance appended to every session's system prompt.
//!
//! Harness defaults disagree on how to cite files (Claude Code suggests
//! `path:line`, Codex emits markdown links). The product transcript renders
//! markdown links with path destinations as clickable file mentions, so we
//! steer every harness toward that one shape.

/// Instruction telling models to format file references as markdown links
/// with workspace-root-relative destinations (optionally `:line` suffixed),
/// falling back to absolute paths only outside the workspace.
pub const FILE_REFERENCE_INSTRUCTIONS: &str = "When referencing a file in your responses, format it as a markdown link: the text is the file name or workspace-relative path, and the destination is the path relative to the workspace root, optionally suffixed with :line — for example [models.rs](src/models.rs:42) or [README.md](README.md). Use an absolute path destination only for files outside the workspace root. Prefer these links over bare or backticked paths whenever you mention a specific file.";

/// System prompt append entries applied to every session, regardless of
/// harness or workspace surface.
pub fn system_prompt_append() -> Vec<String> {
    vec![FILE_REFERENCE_INSTRUCTIONS.to_string()]
}
