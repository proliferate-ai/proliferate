import { describe, expect, it } from "vitest";
import {
  buildDelegatedWorkTabIdentity,
  delegatedWorkKindFromSource,
  delegatedWorkStatusCategoryFromLabel,
  reviewRunStatusCategory,
  selectSingleDelegatedAgentTriggerIdentity,
  shouldShowDelegatedWorkInComposer,
} from "@/lib/domain/delegated-work/presentation";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";

describe("delegatedWorkKindFromSource", () => {
  it("derives plan/code review kinds from review run kind", () => {
    expect(delegatedWorkKindFromSource({ source: "review", reviewKind: "code" }))
      .toBe("code_review");
    expect(delegatedWorkKindFromSource({ source: "review", reviewKind: "plan" }))
      .toBe("plan_review");
  });
});

describe("delegatedWorkStatusCategoryFromLabel", () => {
  it("maps common child status labels into shared categories", () => {
    expect(delegatedWorkStatusCategoryFromLabel({ statusLabel: "Working" })).toBe("running");
    expect(delegatedWorkStatusCategoryFromLabel({ statusLabel: "Failed" })).toBe("failed");
    expect(delegatedWorkStatusCategoryFromLabel({ statusLabel: "Changes" })).toBe("needs_attention");
    expect(delegatedWorkStatusCategoryFromLabel({ statusLabel: "Done" })).toBe("finished");
    expect(delegatedWorkStatusCategoryFromLabel({
      statusLabel: "Idle",
      wakeScheduled: true,
    })).toBe("wake_scheduled");
  });
});

describe("reviewRunStatusCategory", () => {
  it("keeps feedback and waiting states visible as attention states", () => {
    expect(reviewRunStatusCategory("feedback_ready")).toBe("needs_attention");
    expect(reviewRunStatusCategory("waiting_for_revision")).toBe("needs_attention");
    expect(reviewRunStatusCategory("parent_revising")).toBe("running");
  });
});

describe("shouldShowDelegatedWorkInComposer", () => {
  it("hides only closed or finished no-action items by default", () => {
    expect(shouldShowDelegatedWorkInComposer({ statusCategory: "finished" })).toBe(false);
    expect(shouldShowDelegatedWorkInComposer({
      statusCategory: "finished",
      hasActionNeeded: true,
    })).toBe(true);
    expect(shouldShowDelegatedWorkInComposer({ statusCategory: "failed" })).toBe(true);
    expect(shouldShowDelegatedWorkInComposer({ statusCategory: "needs_attention" })).toBe(true);
    expect(shouldShowDelegatedWorkInComposer({ statusCategory: "closed" })).toBe(false);
  });
});

describe("selectSingleDelegatedAgentTriggerIdentity", () => {
  it("returns one active or attention identity and keeps generic trigger cases null", () => {
    const running = buildDelegatedAgentIdentity({
      id: "running-agent",
      title: "API Surface Check",
      sessionId: "session-running",
    });
    const failed = buildDelegatedAgentIdentity({
      id: "failed-agent",
      title: "Tests",
      sessionId: "session-failed",
    });
    const finished = buildDelegatedAgentIdentity({
      id: "finished-agent",
      title: "Docs",
      sessionId: "session-finished",
    });

    expect(selectSingleDelegatedAgentTriggerIdentity([
      { identity: running, statusCategory: "running" },
    ])).toBe(running);
    expect(selectSingleDelegatedAgentTriggerIdentity([
      { identity: running, statusCategory: "running" },
      { identity: failed, statusCategory: "failed" },
    ])).toBeNull();
    expect(selectSingleDelegatedAgentTriggerIdentity([
      { identity: finished, statusCategory: "finished" },
    ])).toBeNull();
  });
});

describe("buildDelegatedWorkTabIdentity", () => {
  it("returns generated display identity and hover metadata", () => {
    const tabIdentity = buildDelegatedWorkTabIdentity({
      id: "assignment-1",
      title: "Architecture Review",
      source: "review",
      reviewKind: "plan",
      statusLabel: "Working",
      sessionId: "session-1",
      sessionLinkId: "review_assignment_abc123456",
      parentTitle: "Main chat",
    });

    expect(tabIdentity.kind).toBe("plan_review");
    expect(tabIdentity.originLabel).toBe("Plan review");
    expect(tabIdentity.identity.displayName).toContain("Architecture Review");
    expect(tabIdentity.hoverTitle).toContain("Parent: Main chat");
  });

  it("passes sibling-assigned colorIndex and shapeSalt through to the identity", () => {
    const base = {
      id: "link-subagent-1",
      title: "Explore",
      source: "subagent" as const,
      statusLabel: "Working",
      sessionId: "session-1",
      sessionLinkId: "link-subagent-1",
    };
    const plain = buildDelegatedWorkTabIdentity(base);
    const assigned = buildDelegatedWorkTabIdentity({
      ...base,
      colorIndex: 8,
      shapeSalt: 1,
    });

    expect(assigned.identity.colorToken).toBe("delegated-agent-9");
    expect(assigned.identity.iconSeedHash).not.toBe(plain.identity.iconSeedHash);
  });
});
