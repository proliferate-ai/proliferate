import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { toolItem } from "@/lib/domain/chat/transcript-presentation-test-fixtures";
import { CollapsedActions } from "./CollapsedActions";

describe("CollapsedActions", () => {
  it("does not cap the expanded ledger when it contains edits", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      edit: toolItem("edit", "turn-1", 1, "file_change"),
    };

    const html = renderToStaticMarkup(
      createElement(CollapsedActions, {
        itemIds: ["edit"],
        transcript,
        forceExpanded: true,
      }),
    );

    expect(html).toContain("data-collapsed-actions-ledger");
    expect(html).toContain("Edited");
    expect(html).not.toContain("max-h-80");
    expect(html).not.toContain("max-h-[7.5rem]");
    expect(html).not.toContain("overflow-y-auto overflow-x-hidden");
  });

  it("keeps compact scrolling for expanded non-edit action ledgers", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
    };

    const html = renderToStaticMarkup(
      createElement(CollapsedActions, {
        itemIds: ["read"],
        transcript,
        forceExpanded: true,
      }),
    );

    expect(html).toContain("data-collapsed-actions-ledger");
    expect(html).toContain("Read read.ts");
    expect(html).toContain("overflow-y-auto overflow-x-hidden");
    expect(html).toContain("max-h-[7.5rem]");
  });
});
