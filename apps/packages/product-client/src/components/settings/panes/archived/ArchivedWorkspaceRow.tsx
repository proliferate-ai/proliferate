import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { Button } from "#product/primitives/Button";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { Trash } from "#product/primitives/icons/core";
import { workspaceDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";
import {
  archivedWorkspaceMetaLine,
  type ArchivedWorkspaceSort,
} from "#product/lib/domain/workspaces/archived/archived-workspace-presentation";

export interface ArchivedWorkspaceRowProps {
  workspace: Workspace;
  repoRoots: readonly RepoRoot[];
  sort: ArchivedWorkspaceSort;
  /** Row is mid-exit (unarchive/delete confirmed): collapses out, stays
   * mounted until the disclosure transition finishes. */
  exiting: boolean;
  onUnarchive: (workspaceId: string) => void;
  onDelete: (workspaceId: string) => void;
}

/**
 * Feature code, not `components/patterns/` (§3.12, §9.3 — rule of two, one
 * call site): a thin `SettingsRow` fill whose label/description ramps are
 * exactly the ADR's specified ramps. The row itself draws no border — the
 * owning `SettingsGroup` wash card owns the hairline between rows.
 */
export function ArchivedWorkspaceRow({
  workspace,
  repoRoots,
  sort,
  exiting,
  onUnarchive,
  onDelete,
}: ArchivedWorkspaceRowProps) {
  const title = workspaceDisplayName(workspace);
  return (
    <AnimatedCollapsibleContent expanded={!exiting}>
      <SettingsRow
        label={<span className="truncate">{title}</span>}
        description={archivedWorkspaceMetaLine(workspace, repoRoots, sort)}
      >
        <RowActionIconButton
          label={`Delete ${title} permanently`}
          visibility="always"
          className="hover:bg-destructive-subtle hover:text-destructive"
          onClick={() => onDelete(workspace.id)}
        >
          <Trash />
        </RowActionIconButton>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onUnarchive(workspace.id)}
        >
          Unarchive
        </Button>
      </SettingsRow>
    </AnimatedCollapsibleContent>
  );
}
