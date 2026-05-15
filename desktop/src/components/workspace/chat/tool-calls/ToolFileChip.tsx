import { FileReferenceBadge } from "@/components/workspace/file-references/FileReferenceBadge";

interface ToolFileChipProps {
  basename: string;
  pathLabel: string;
  /** Workspace-relative path. When null, the chip falls back to external-only actions. */
  workspacePath: string | null;
}

/**
 * File chip used in tool-call headers (`Read`, `Edited`, etc.).
 *
 * Behavior matches `FilePathLink`:
 *  - Click -> open in the workspace right-sidebar viewer when possible.
 *  - Right-click -> external open targets, copy path, reveal in Finder.
 *
 * Visual is intentionally a chip (border + background + file icon) so tool
 * results stay scannable; markdown prose uses the flat `FilePathLink` instead.
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
      variant="chip"
    />
  );
}
