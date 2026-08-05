import { describe, expect, it } from "vitest";
import {
  isResolvedPlanAttachment,
  planAttachmentDescriptorFromDetail,
  planAttachmentId,
  planAttachmentPlaceholderFromPointer,
  planAttachmentPointerFromDescriptor,
  planReferenceContentPartFromDescriptor,
} from "./prompt-plan-attachments";

describe("prompt plan attachments", () => {
  it("derives stable attachment ids and pointers from resolved plan details", () => {
    const descriptor = planAttachmentDescriptorFromDetail({
      id: "plan-123",
      title: "Implementation Plan",
      bodyMarkdown: "# Plan",
      snapshotHash: "hash-123",
      sourceSessionId: "session-123",
      sourceTurnId: "turn-123",
      sourceItemId: "item-123",
      sourceKind: "codex",
      sourceAgentKind: "codex",
      sourceToolCallId: "tool-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      decisionState: "pending",
      decisionVersion: 1,
      itemId: "item-123",
      nativeResolutionState: "none",
      sessionId: "session-123",
      updatedAt: "2026-01-01T00:00:00.000Z",
      workspaceId: "workspace-123",
    });

    expect(descriptor.id).toBe(planAttachmentId("plan-123", "hash-123"));
    expect(planAttachmentPointerFromDescriptor(descriptor)).toEqual({
      id: "plan:plan-123:hash-123",
      kind: "plan_reference",
      planId: "plan-123",
      snapshotHash: "hash-123",
    });
    expect(planReferenceContentPartFromDescriptor(descriptor)).toMatchObject({
      type: "plan_reference",
      planId: "plan-123",
      snapshotHash: "hash-123",
    });
    expect(isResolvedPlanAttachment(descriptor)).toBe(true);
  });

  it("marks unresolved pointers as non-ready plan attachments", () => {
    const placeholder = planAttachmentPlaceholderFromPointer({
      id: "plan:plan-123:hash-123",
      kind: "plan_reference",
      planId: "plan-123",
      snapshotHash: "hash-123",
    }, "error", "Plan lookup failed.");

    expect(placeholder).toMatchObject({
      title: "Plan unavailable",
      bodyMarkdown: "Plan lookup failed.",
      resolutionState: "error",
      resolutionMessage: "Plan lookup failed.",
    });
    expect(isResolvedPlanAttachment(placeholder)).toBe(false);
  });
});
