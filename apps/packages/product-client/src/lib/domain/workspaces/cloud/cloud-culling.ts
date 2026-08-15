/**
 * Cloud culling (PRO-10) data-source filter — FR-2.
 *
 * The single data-source-layer choke point where existing cloud state is
 * removed before any client list consumer reads it. Filtering happens here,
 * once, never per-component, so no reachable list (sidebar, pickers, command
 * palette, workspaces page) can resurrect a cloud surface from stale rows
 * (FM1). Server rows are never deleted; they are simply never surfaced.
 *
 * Carve-out (FR-2 / FM5): cloud-target automations are deliberately NOT handled
 * here. The user authored them, so they stay listed and are badged
 * "target no longer available" in the automations list. This filter only ever
 * receives workspace rows and cloud-only repositories, so automation records
 * pass through the rest of the app untouched by construction.
 */

import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { RepositoryAvailability } from "#product/lib/domain/settings/repositories";

/**
 * Remove every existing cloud workspace row from a client list. Cloud
 * workspaces arrive as their own array at the data-source seam
 * (`buildWorkspaceCollections`), so culling is a total drop: cloud rows in,
 * zero cloud rows out.
 */
export function cullCloudWorkspaceRows(
  _cloudWorkspaces: readonly CloudWorkspaceSummary[],
): CloudWorkspaceSummary[] {
  return [];
}

/**
 * A cloud-only repository (a repo whose only environment is cloud, with no
 * local checkout) is a cloud surface, so it is hidden entirely — never shown
 * as "local, not yet set up" (FR-2 overrules the research default). Repos that
 * are local, or local with cloud also configured (`local_cloud`), stay.
 */
export function isCulledCloudOnlyRepository(
  availability: RepositoryAvailability,
): boolean {
  return availability === "cloud";
}
