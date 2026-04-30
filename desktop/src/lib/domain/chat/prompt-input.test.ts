import { describe, expect, it } from "vitest";
import type { PromptInputBlock } from "@anyharness/sdk";
import { dedupePlanReferenceBlocks, hasPromptContent } from "./prompt-input";

describe("prompt input helpers", () => {
  it("treats plan-only prompts as prompt content", () => {
    const blocks: PromptInputBlock[] = [{
      type: "plan_reference",
      planId: "plan-123",
      snapshotHash: "hash-123",
    }];

    expect(hasPromptContent("", blocks)).toBe(true);
  });

  it("ignores empty text blocks when deciding whether a prompt has content", () => {
    expect(hasPromptContent("   ", [{ type: "text", text: "   " }])).toBe(false);
    expect(hasPromptContent("Hello", [])).toBe(true);
  });

  it("dedupes plan references without dropping other block types", () => {
    const blocks: PromptInputBlock[] = [
      { type: "text", text: "Use this" },
      { type: "plan_reference", planId: "plan-123", snapshotHash: "hash-123" },
      { type: "plan_reference", planId: "plan-123", snapshotHash: "hash-123" },
      { type: "plan_reference", planId: "plan-123", snapshotHash: "hash-456" },
    ];

    expect(dedupePlanReferenceBlocks(blocks)).toEqual([
      { type: "text", text: "Use this" },
      { type: "plan_reference", planId: "plan-123", snapshotHash: "hash-123" },
      { type: "plan_reference", planId: "plan-123", snapshotHash: "hash-456" },
    ]);
  });
});
