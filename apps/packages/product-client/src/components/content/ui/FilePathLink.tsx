import { memo, type ReactNode } from "react";
import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";

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
 *  - Actionable references expose their authority-shaped primary and menu actions.
 *  - A nonempty unavailable reference exposes Copy path only.
 *  - An empty or whitespace reference exposes no controls.
 *
 * Style: local file/doc link in `text-link-foreground`, no pill,
 * no border, underline on hover only.
 */
export const FilePathLink = memo(function FilePathLink({
  rawPath,
  children,
}: FilePathLinkProps) {
  return (
    <FileReferenceBadge rawPath={rawPath} label={children} variant="inline" />
  );
});
