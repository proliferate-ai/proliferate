//! Response formatting guidance appended to every session's system prompt.
//!
//! Harness defaults disagree on how to cite files (Claude Code suggests
//! `path:line`, Codex emits markdown links). The product transcript renders
//! markdown links with path destinations as clickable file mentions, so we
//! steer every harness toward that one shape.

/// Instruction telling models to format file references as markdown links
/// with workspace-root-relative destinations (optionally `:line` suffixed),
/// falling back to absolute paths only outside the workspace.
pub const FILE_REFERENCE_INSTRUCTIONS: &str = "When referencing a file in your responses, format it as a markdown link. The destination MUST be the file's complete path from the workspace root — every leading directory included, exactly as it appears in the file tree (e.g. what `git ls-files` prints) — never abbreviated and never relative to the current file or a subdirectory. The link text can be just the file name. Optionally suffix the destination with :line. For example, in a monorepo: [MarkdownRenderer.tsx](apps/desktop/src/components/content/ui/MarkdownRenderer.tsx:142), or [README.md](README.md). Use an absolute path destination only for files outside the workspace root. Prefer these links over bare or backticked paths whenever you mention a specific file.";

/// System prompt append entries applied to every session, regardless of
/// harness or workspace surface.
pub fn system_prompt_append() -> Vec<String> {
    vec![FILE_REFERENCE_INSTRUCTIONS.to_string()]
}
