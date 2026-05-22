import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { toolItem } from "@proliferate/product-model/chats/transcript/transcript-presentation-test-fixtures";
import { SubagentCreationGroupBlock } from "./SubagentCreationGroupBlock";

describe("SubagentCreationGroupBlock", () => {
  it("uses the standard collapsed action trigger treatment", () => {
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

    expect(html).toContain("group/collapsed-actions");
    expect(html).toContain("rounded-none bg-transparent p-0");
    expect(html).toContain("text-[length:var(--text-chat)]");
    expect(html).toContain("text-muted-foreground/60");
    expect(html).toContain("Created 2 subagents");
    expect(html).toContain("group-hover/collapsed-actions:opacity-100");
  });
});
