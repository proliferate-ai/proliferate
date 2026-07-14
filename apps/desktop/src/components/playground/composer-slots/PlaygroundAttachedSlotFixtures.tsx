import type { ReactNode } from "react";
import type { ScenarioKey } from "@/config/playground";
import { renderGoalBarSlot } from "@/components/playground/activity/GoalBarFixtures";
import {
  renderActivityChipsSlot,
  renderActivityWithGoalSlot,
} from "@/components/playground/activity/ActivityFixtures";
import { renderDelegationSlot } from "@/components/playground/delegation/PlaygroundComposerDelegation";
import { renderPanelSlotFixture } from "@/components/playground/composer-slots/PlaygroundPanelSlotFixtures";
import { WorkspaceActivityComposerCard } from "@/components/workspace/chat/input/workspace-activity/WorkspaceActivityComposerCard";
import { createPlaygroundWorkspaceActivityModel } from "@/lib/domain/chat/__fixtures__/playground/composer-surface-fixtures";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function renderAttachedSlot(scenario: ScenarioKey): ReactNode | null {
  const contextPanel = (() => {
    switch (scenario) {
      case "workspace-arrival-created":
      case "cloud-first-runtime":
      case "cloud-provisioning":
      case "cloud-applying-files":
      case "cloud-blocked":
      case "cloud-error":
      case "cloud-reconnecting":
      case "cloud-reconnect-error":
        return renderPanelSlotFixture(scenario);
      default:
        return null;
    }
  })();
  const delegationPanel = renderDelegationSlot(scenario);
  const goalBar = renderGoalBarSlot(scenario);
  const activityChips = renderActivityChipsSlot(scenario) ?? renderActivityWithGoalSlot(scenario);
  // The Git/PR cap renders last so it docks flush onto the composer,
  // matching useComposerDockSlots ordering in the product.
  const workspaceActivityCap = scenario === "workspace-activity-card"
    ? (
      <WorkspaceActivityComposerCard
        model={createPlaygroundWorkspaceActivityModel()}
        pullRequestActionLabel="Create pull request"
        onCopyBranch={noop}
        onOpenChanges={noop}
        onCommit={noop}
        onPublish={noop}
        onPullRequest={noop}
      />
    )
    : null;

  if (!contextPanel && !delegationPanel && !goalBar && !activityChips && !workspaceActivityCap) {
    return null;
  }

  return (
    <>
      {contextPanel}
      {delegationPanel}
      {goalBar}
      {activityChips}
      {workspaceActivityCap}
    </>
  );
}
