import type { ReactNode } from "react";
import type { ScenarioKey } from "@/config/playground";
import { renderPanelSlotFixture } from "@/components/playground/composer-slots/PlaygroundPanelSlotFixtures";

export function renderActiveSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "todos-short":
    case "todos-mid":
    case "todos-long":
    case "todo-strip-with-approval":
    case "execute-approval":
    case "edit-approval":
    case "interaction-motion":
    case "interaction-marker-permission":
    case "interaction-marker-question":
    case "pending-prompts-with-approval":
    case "subagents-queued-wake-with-approval":
    case "gemini-mcp-approval-options":
    case "gemini-tool-before-approval":
    case "user-input-single-option":
    case "user-input-single-freeform":
    case "user-input-option-plus-other":
    case "user-input-secret":
    case "user-input-multi-question":
    case "mcp-elicitation-boolean":
    case "mcp-elicitation-enum":
    case "mcp-elicitation-multi-select":
    case "mcp-elicitation-mixed-required":
    case "mcp-elicitation-url":
    case "mcp-elicitation-validation-error":
    case "mcp-elicitation-cancel-decline":
      return renderPanelSlotFixture(scenario);
    default:
      return null;
  }
}
