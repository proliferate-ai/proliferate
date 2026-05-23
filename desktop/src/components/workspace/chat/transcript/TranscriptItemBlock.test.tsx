// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createTranscriptState, type ToolCallItem } from "@anyharness/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { toolItem } from "@proliferate/product-model/chats/transcript/transcript-presentation-test-fixtures";
import { ProposedPlanToolCallIdsProvider } from "./ProposedPlanToolCallIdsContext";
import { TranscriptItemBlock } from "./TranscriptItemBlock";

afterEach(() => {
  cleanup();
});

describe("TranscriptItemBlock", () => {
  it("suppresses Claude plan fallback rendering when the source item id matches", () => {
    const transcript = createTranscriptState("session-1");
    const fallback = claudeExitPlanFallback();
    transcript.itemsById = { fallback };

    const { container } = render(
      <ProposedPlanToolCallIdsProvider value={new Set(["fallback"])}>
        <TranscriptItemBlock
          item={fallback}
          transcript={transcript}
          workspaceId={null}
          onOpenArtifact={() => {}}
        />
      </ProposedPlanToolCallIdsProvider>,
    );

    expect(container.textContent).not.toContain("Fallback plan body");
  });

  it("renders Claude plan fallback content when no proposed plan source matches", () => {
    const transcript = createTranscriptState("session-1");
    const fallback = claudeExitPlanFallback();
    transcript.itemsById = { fallback };

    const { container } = render(
      <ProposedPlanToolCallIdsProvider value={new Set()}>
        <TranscriptItemBlock
          item={fallback}
          transcript={transcript}
          workspaceId={null}
          onOpenArtifact={() => {}}
        />
      </ProposedPlanToolCallIdsProvider>,
    );

    expect(container.textContent).toContain("Fallback plan body");
  });
});

function claudeExitPlanFallback(): ToolCallItem {
  return {
    ...toolItem("fallback", "turn-1", 1, "mode_switch"),
    sourceAgentKind: "claude",
    nativeToolName: "ExitPlanMode",
    toolCallId: null,
    contentParts: [{ type: "tool_result_text", text: "Fallback plan body" }],
  };
}
