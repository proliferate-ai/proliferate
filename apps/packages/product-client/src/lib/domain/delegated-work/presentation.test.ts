import { describe, expect, it } from "vitest";
import {
  buildDelegatedWorkTabIdentity,
  delegatedWorkStatusCategoryFromLabel,
  selectSingleDelegatedAgentTriggerIdentity,
  shouldShowDelegatedWorkInComposer,
} from "#product/lib/domain/delegated-work/presentation";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

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
      title: "Architecture Survey",
      statusLabel: "Working",
      sessionId: "session-1",
      sessionLinkId: "subagent_abc123456",
      parentTitle: "Main chat",
    });

    expect(tabIdentity.kind).toBe("subagent");
    expect(tabIdentity.originLabel).toBe("Subagent");
    expect(tabIdentity.identity.displayName).toContain("Architecture Survey");
    expect(tabIdentity.hoverTitle).toContain("Parent: Main chat");
  });
});
