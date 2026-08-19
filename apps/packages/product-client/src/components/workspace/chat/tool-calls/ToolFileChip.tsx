import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";

interface ToolFileChipProps {
  basename: string;
  /** Raw wire path; never replaced by normalized workspace metadata. */
  rawPath: string;
  /**
   * Supplied structured workspace paths are authoritative; otherwise the
   * shared file-reference resolver classifies `rawPath`.
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
 *  - A nonempty unavailable path has Copy path only; an empty path has no controls.
 *
 * Visual is intentionally a chip (border + background + file icon) so tool
 * results stay scannable; markdown prose uses the flat `FilePathLink` instead.
 */
export function ToolFileChip({
  basename,
  rawPath,
  workspacePath,
}: ToolFileChipProps) {
  return (
    <FileReferenceBadge
      rawPath={rawPath}
      basename={basename}
      label={basename}
      workspacePath={workspacePath}
      variant="chip"
    />
  );
}
