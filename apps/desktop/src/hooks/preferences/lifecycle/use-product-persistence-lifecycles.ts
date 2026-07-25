import { useHomeNextTargetSelectionLifecycle } from "@/hooks/home/lifecycle/use-home-next-target-selection-lifecycle";
import { useSessionReplacementTombstonesLifecycle } from "@/hooks/sessions/lifecycle/use-session-replacement-tombstones-lifecycle";
import {
  useCloudDisplayNameBackfillSuppressionLifecycle,
} from "@/hooks/workspaces/lifecycle/cloud-display-name-backfill-suppression";
import { useChatDiffPreferencesLifecycle } from "./use-chat-diff-preferences-lifecycle";
import { useFileTreePreferencesLifecycle } from "./use-file-tree-preferences-lifecycle";
import { useRepoPreferencesLifecycle } from "./use-repo-preferences-lifecycle";
import { useUserPreferencesLifecycle } from "./use-user-preferences-lifecycle";
import { useWorkspaceUiLifecycle } from "./use-workspace-ui-lifecycle";
import { useSessionSelectionLifecycle } from "@/hooks/sessions/lifecycle/use-session-selection-lifecycle";

/** The one shared product persistence lifecycle group mounted by the product root. */
export function useProductPersistenceLifecycles(): void {
  useUserPreferencesLifecycle();
  useRepoPreferencesLifecycle();
  useWorkspaceUiLifecycle();
  useSessionSelectionLifecycle();
  useChatDiffPreferencesLifecycle();
  useFileTreePreferencesLifecycle();
  useHomeNextTargetSelectionLifecycle();
  useCloudDisplayNameBackfillSuppressionLifecycle();
  useSessionReplacementTombstonesLifecycle();
}
