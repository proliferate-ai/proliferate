import type { ReactNode } from "react";
import type { ScenarioKey } from "#product/config/playground";
import { renderGoalBarSlot } from "#product/components/playground/activity/GoalBarFixtures";
import {
  renderActivityChipsSlot,
  renderActivityWithGoalSlot,
} from "#product/components/playground/activity/ActivityFixtures";
import { renderDelegationSlot } from "#product/components/playground/delegation/PlaygroundComposerDelegation";
import { renderPanelSlotFixture } from "#product/components/playground/composer-slots/PlaygroundPanelSlotFixtures";

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

  if (!contextPanel && !delegationPanel && !goalBar && !activityChips) {
    return null;
  }

  return (
    <>
      {contextPanel}
      {delegationPanel}
      {goalBar}
      {activityChips}
    </>
  );
}
