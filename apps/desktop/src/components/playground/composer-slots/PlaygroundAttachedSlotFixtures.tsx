import type { ReactNode } from "react";
import type { ScenarioKey } from "@/config/playground";
import { renderGoalBarSlot } from "@/components/playground/activity/GoalBarFixtures";
import { renderDelegationSlot } from "@/components/playground/delegation/PlaygroundComposerDelegation";
import { renderPanelSlotFixture } from "@/components/playground/composer-slots/PlaygroundPanelSlotFixtures";

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

  if (!contextPanel && !delegationPanel && !goalBar) {
    return null;
  }

  return (
    <>
      {contextPanel}
      {delegationPanel}
      {goalBar}
    </>
  );
}
