// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentCreationGroupBlock } from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock";
import { workspaceCreateAgent } from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock.test-fixtures";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

// Split out of SubagentCreationGroupBlock.test.tsx for PROD-SIZE-1 (that file
// hit the 600-line cap once this negative control landed). Mechanical move,
// same mocks the parent file needs to render SubagentCreationGroupBlock at
// all — no assertions changed. See PROD-SIZE-1 precedent
// (BackgroundWorkPane.test.tsx / BackgroundWorkPane.finish-signals.test.tsx):
// this file keeps its own ".test." mid-name segment so vitest still
// discovers it as a suite.
const mocks = vi.hoisted(() => ({
  openAgentsPaneTarget: vi.fn(() => false),
  openWorkspaceSession: vi.fn(),
  selectedWorkspaceId: "workspace-1" as string | null,
  projectedWorkspaceIds: new Set<string>(),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("#product/hooks/agents/workflows/use-agents-pane-navigation-actions")
  >();
  return {
    ...original,
    useAgentsPaneNavigationActions: () => ({
      classifyAgentsPaneTarget: () => "subagent" as const,
      openAgentsPaneTarget: mocks.openAgentsPaneTarget,
    }),
  };
});

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    selectedWorkspaceId: mocks.selectedWorkspaceId,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      allWorkspaces: [...mocks.projectedWorkspaceIds].map((id) => ({ id })),
    },
  }),
}));

beforeEach(() => {
  mocks.openAgentsPaneTarget.mockReset().mockReturnValue(false);
  mocks.openWorkspaceSession.mockReset();
  mocks.selectedWorkspaceId = "workspace-1";
  mocks.projectedWorkspaceIds = new Set(["workspace-1"]);
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
});

afterEach(() => {
  cleanup();
});

describe("SubagentCreationGroupBlock", () => {
  // Negative control (rung R7): R7 gives the *native* subagent transcript
  // block its own identity treatment, reusing this component's creation-run
  // anatomy as a visual reference. It changes nothing in this file, so the
  // delegated-work creation run — wrapper, chip, and trailing verb — must
  // keep rendering exactly as it does today.
  it("R7 negative control: delegated creation-run rendering is unaffected by the native identity treatment", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
    };

    const { container } = render(
      <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />,
    );

    expect(container.querySelector("[data-subagent-creation-run]")).toBeTruthy();
    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
    expect(screen.getByText("Schema audit")).toBeTruthy();
    expect(screen.getByText("started working")).toBeTruthy();
  });
});
