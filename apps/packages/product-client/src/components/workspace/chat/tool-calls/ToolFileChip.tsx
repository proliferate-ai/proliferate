import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";

interface ToolFileChipProps {
  basename: string;
  pathLabel: string;
  /**
   * Known workspace-relative path. Missing nullable metadata is inferred from
   * pathLabel by the shared file-reference resolver.
   */
  workspacePath: string | null | undefined;
}

/**
 * File chip used in tool-call headers (`Read`, `Edited`, etc.).
 *
 * Behavior matches `FilePathLink`:
 *  - Click -> open in the workspace viewer, or use the configured Desktop
 *    target for an external file.
 *  - Actionable references expose external targets, copy, and reveal through
 *    the context menu.
 *  - An unavailable path is non-interactive text.
 *
 * Tool rows are the file-reference styling exception: the row's semantic icon
 * already identifies the action, so the filename stays glyph-free and inherits
 * the row color with an always-visible dotted underline.
 */
export function ToolFileChip({
  basename,
  pathLabel,
  workspacePath,
}: ToolFileChipProps) {
  return (
    <FileReferenceBadge
      rawPath={pathLabel}
      basename={basename}
      label={basename}
      workspacePath={workspacePath}
      variant="plain"
    />
  );
}
