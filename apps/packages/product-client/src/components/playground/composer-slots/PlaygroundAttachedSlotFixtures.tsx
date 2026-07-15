import type { ReactNode } from "react";
import type { ScenarioKey } from "#product/config/playground";
import { renderGoalBarSlot } from "#product/components/playground/activity/GoalBarFixtures";
import {
  renderActivityChipsSlot,
  renderActivityWithGoalSlot,
} from "#product/components/playground/activity/ActivityFixtures";
import { renderDelegationSlot } from "#product/components/playground/delegation/PlaygroundComposerDelegation";
import { renderPanelSlotFixture } from "#product/components/playground/composer-slots/PlaygroundPanelSlotFixtures";
import { WorkspaceActivityComposerCard } from "#product/components/workspace/chat/input/workspace-activity/WorkspaceActivityComposerCard";
import { createPlaygroundWorkspaceActivityModel } from "#product/lib/domain/chat/__fixtures__/playground/composer-surface-fixtures";
import { noop } from "#product/components/playground/PlaygroundComposerActions";

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
