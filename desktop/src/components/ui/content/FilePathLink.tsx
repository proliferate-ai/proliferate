import type { ReactNode } from "react";
import { FileReferenceBadge } from "@/components/workspace/file-references/FileReferenceBadge";

interface FilePathLinkProps {
  /**
   * Raw path string as it appeared in the source. May be relative,
   * absolute, or carry an optional `:line[:col]` suffix.
   */
  rawPath: string;
  /** Optional override for displayed text. Defaults to `rawPath`. */
  children?: ReactNode;
}

/**
 * Inline file-path link rendered in chat markdown and tool-call output.
 *
 * Behavior:
 *  - Click -> open the file in the workspace right-sidebar viewer.
 *  - Context menu -> external open targets, copy path, reveal in Finder.
 *
 * Style: Codex-style local file/doc link in `text-link-foreground`, no pill,
 * no border, underline on hover only.
 */
export function FilePathLink({ rawPath, children }: FilePathLinkProps) {
  return (
    <FileReferenceBadge rawPath={rawPath} label={children} variant="inline" />
  );
}
