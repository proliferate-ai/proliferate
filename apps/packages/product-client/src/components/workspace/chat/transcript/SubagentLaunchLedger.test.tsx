// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentLaunchLedger } from "#product/components/workspace/chat/transcript/SubagentLaunchLedger";
import type { SubagentExecutionState } from "#product/domain/chats/subagents/subagent-launch";

afterEach(cleanup);

const SUPPRESSED_STATES: SubagentExecutionState[] = [
  "running",
  "background",
  "completed_background",
];

const VISIBLE_STATES: Array<[SubagentExecutionState, string]> = [
  ["completed", "Started"],
  ["failed", "Launch failed"],
  ["expired_background", "Stopped updating"],
];

describe("SubagentLaunchLedger", () => {
  it.each(SUPPRESSED_STATES)(
    "renders nothing for the retired %s status line",
    (executionState) => {
      const { container } = render(
        <SubagentLaunchLedger executionState={executionState} />,
      );

      expect(container.innerHTML).toBe("");
    },
  );

  it.each(VISIBLE_STATES)(
    "renders the status line for execution state %s",
    (executionState, expectedLabel) => {
      const { getByText } = render(
        <SubagentLaunchLedger executionState={executionState} />,
      );

      expect(getByText(expectedLabel)).not.toBeNull();
    },
  );

  it("never renders a prompt disclosure affordance — that moved to BackgroundSubagentView", () => {
    const { queryByText } = render(
      <SubagentLaunchLedger executionState="completed" />,
    );

    expect(queryByText("View initial prompt")).toBeNull();
  });
});
