import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { toolItem } from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
import { SubagentCreationGroupBlock } from "./SubagentCreationGroupBlock";

describe("SubagentCreationGroupBlock", () => {
  it("renders a quiet done-line for finished subagents", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": toolItem("create-1", "turn-1", 1, "subagent"),
      "create-2": toolItem("create-2", "turn-1", 2, "subagent"),
    };

    const html = renderToStaticMarkup(
      createElement(SubagentCreationGroupBlock, {
        itemIds: ["create-1", "create-2"],
        transcript,
      }),
    );

    // Quiet collapsible line treatment (muted, chat-sized, transparent).
    expect(html).toContain("group/collapsed-actions");
    expect(html).toContain("rounded-none bg-transparent p-0");
    expect(html).toContain("text-[length:var(--text-chat)]");
    expect(html).toContain("text-muted-foreground/60");
    // Completion-time copy, not the old spawn-time "Created …" line.
    expect(html).toContain("2 subagents finished");
    expect(html).not.toContain("Created");
  });

  it("renders nothing while a subagent is still running (roster owns it)", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": toolItem("create-1", "turn-1", 1, "subagent", "in_progress"),
    };

    const html = renderToStaticMarkup(
      createElement(SubagentCreationGroupBlock, {
        itemIds: ["create-1"],
        transcript,
      }),
    );

    expect(html).toBe("");
  });
});
