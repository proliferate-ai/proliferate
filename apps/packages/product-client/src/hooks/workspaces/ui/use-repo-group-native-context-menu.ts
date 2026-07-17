import { useNativeContextMenu } from "#product/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";
import type { RepoGroupEnvironmentKind } from "#product/components/workspace/shell/sidebar/RepoGroup";

/** The availability/configuration commands the repo `…` and right-click menus
 * can present, per the PR 2 minimum matrix. */
export type RepoGroupMenuActionId =
  | "set-up-cloud"
  | "add-to-this-mac"
  | "cloud-settings"
  | "repository-settings"
  | "remove-repository";

export interface RepoGroupMenuAction {
  id: RepoGroupMenuActionId;
  label: string;
  /** Rendered with the destructive treatment and separated from the rest. */
  destructive?: boolean;
}

export interface RepoGroupMenuModelInput {
  environmentKind: RepoGroupEnvironmentKind;
  /** The repo has a supported GitHub owner/name identity (Cloud-capable). */
  isGitHubRepo: boolean;
  /** Desktop + a non-disabled managed-Cloud capability can offer "Set up Cloud". */
  canSetUpCloud: boolean;
  /** Desktop can register an existing local folder for a Cloud repo. */
  canAddToThisMac: boolean;
  canOpenCloudSettings: boolean;
  canOpenRepositorySettings: boolean;
  canRemoveRepo: boolean;
}

/**
 * The single ordered menu model both the DOM popover and the native right-click
 * menu render, so the two surfaces stay in parity by construction.
 *
 * Matrix (PR 2):
 *   local:       Set up Cloud | Repository settings | Remove repository
 *   cloud:       Add to this Mac… | Cloud settings | Repository settings | Remove
 *   local_cloud: Cloud settings | Repository settings | Remove
 *
 * Cloud setup actions are omitted for a non-GitHub local repo.
 */
export function buildRepoGroupMenuModel(
  input: RepoGroupMenuModelInput,
): RepoGroupMenuAction[] {
  const actions: RepoGroupMenuAction[] = [];

  if (input.environmentKind === "local") {
    if (input.isGitHubRepo && input.canSetUpCloud) {
      actions.push({ id: "set-up-cloud", label: "Set up Cloud" });
    }
  } else {
    // cloud / local_cloud rows are inherently GitHub-backed.
    if (input.environmentKind === "cloud" && input.canAddToThisMac) {
      actions.push({ id: "add-to-this-mac", label: "Add to this Mac…" });
    }
    if (input.canOpenCloudSettings) {
      actions.push({ id: "cloud-settings", label: "Cloud settings" });
    }
  }

  if (input.canOpenRepositorySettings) {
    actions.push({ id: "repository-settings", label: "Repository settings" });
  }
  if (input.canRemoveRepo) {
    actions.push({ id: "remove-repository", label: "Remove repository", destructive: true });
  }

  return actions;
}

export type RepoGroupMenuHandlers = Partial<
  Record<RepoGroupMenuActionId, () => void>
>;

/** Native right-click menu items derived from the shared model. A separator is
 * inserted before the destructive remove command. */
export function buildRepoGroupNativeContextMenuItems(
  model: RepoGroupMenuAction[],
  handlers: RepoGroupMenuHandlers,
): NativeMenuItem[] {
  const items: NativeMenuItem[] = [];
  model.forEach((action, index) => {
    if (action.destructive && index > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      id: action.id,
      label: action.label,
      onSelect: () => handlers[action.id]?.(),
    });
  });
  return items;
}

export function useRepoGroupNativeContextMenu(
  model: RepoGroupMenuAction[],
  handlers: RepoGroupMenuHandlers,
) {
  return useNativeContextMenu(() =>
    buildRepoGroupNativeContextMenuItems(model, handlers),
  );
}
