import { describe, expect, it } from "vitest";
import {
  activitySubagentToDelegatedWorkFields,
  parseActivitySubagentWire,
  sortSubagentsForDisplay,
  subagentDisplayTitle,
  subagentStatusLabel,
  subagentStatusToDelegatedWorkStatusCategory,
  subagentStatusTone,
  subagentUsageDurationLabel,
  type ActivitySubagentWire,
} from "./subagent";

function subagent(overrides: Partial<ActivitySubagentWire> = {}): ActivitySubagentWire {
  return {
    id: "task-1",
    agentType: "general-purpose",
    description: "API surface check",
    model: "claude-opus-4",
    background: true,
    status: { status: "running" },
    usage: null,
    feed: { feedId: "feed-1", kind: "transcript" },
    ...overrides,
  };
}

describe("parseActivitySubagentWire", () => {
  it("round-trips a full wire payload", () => {
    const wire = subagent({
      status: { status: "completed", summary: "Found one SDK mismatch." },
      usage: { tokensUsed: 4_200, toolCalls: 6, durationSeconds: 90 },
    });
    expect(parseActivitySubagentWire(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  });

  it("treats absent optionals as null", () => {
    const parsed = parseActivitySubagentWire({
      id: "task-2",
      background: false,
      status: { status: "failed" },
    });
    expect(parsed).toEqual(subagent({
      id: "task-2",
      agentType: null,
      description: null,
      model: null,
      background: false,
      status: { status: "failed" },
      usage: null,
      feed: null,
    }));
  });

  it("rejects malformed status shapes", () => {
    expect(parseActivitySubagentWire({ ...subagent(), status: { status: "queued" } })).toBeNull();
    expect(parseActivitySubagentWire({ ...subagent(), status: null })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseActivitySubagentWire(null)).toBeNull();
    expect(parseActivitySubagentWire(7)).toBeNull();
  });
});

describe("status label / tone", () => {
  it("labels running/completed/failed", () => {
    expect(subagentStatusLabel(subagent())).toBe("Running");
    expect(subagentStatusTone(subagent())).toBe("default");

    const completed = subagent({ status: { status: "completed", summary: null } });
    expect(subagentStatusLabel(completed)).toBe("Completed");
    expect(subagentStatusTone(completed)).toBe("positive");

    const failed = subagent({ status: { status: "failed" } });
    expect(subagentStatusLabel(failed)).toBe("Failed");
    expect(subagentStatusTone(failed)).toBe("danger");
  });
});

describe("subagentDisplayTitle", () => {
  it("prefers description, falls back to agentType, then a generic label", () => {
    expect(subagentDisplayTitle(subagent())).toBe("API surface check");
    expect(subagentDisplayTitle(subagent({ description: null }))).toBe("general-purpose");
    expect(subagentDisplayTitle(subagent({ description: null, agentType: null }))).toBe("Subagent");
  });
});

describe("sortSubagentsForDisplay", () => {
  it("puts running subagents first", () => {
    const running = subagent({ id: "a" });
    const completed = subagent({ id: "b", status: { status: "completed", summary: null } });
    expect(sortSubagentsForDisplay([completed, running]).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("subagentUsageDurationLabel", () => {
  it("returns null without usage", () => {
    expect(subagentUsageDurationLabel(null, Date.now())).toBeNull();
  });

  it("labels a short duration as now", () => {
    expect(
      subagentUsageDurationLabel({ tokensUsed: null, toolCalls: null, durationSeconds: 30 }, 1_000_000),
    ).toBe("now");
  });
});

describe("delegated-work roster mapping", () => {
  it("maps running/completed/failed to running/finished/failed", () => {
    expect(subagentStatusToDelegatedWorkStatusCategory({ status: "running" })).toBe("running");
    expect(subagentStatusToDelegatedWorkStatusCategory({ status: "completed", summary: null }))
      .toBe("finished");
    expect(subagentStatusToDelegatedWorkStatusCategory({ status: "failed" })).toBe("failed");
  });

  it("maps the pure field subset for delegated-work rendering", () => {
    const completed = subagent({
      status: { status: "completed", summary: "Found one SDK mismatch." },
    });
    expect(activitySubagentToDelegatedWorkFields(completed)).toEqual({
      kind: "subagent",
      source: "activity_roster",
      title: "API surface check",
      statusCategory: "finished",
      background: true,
      model: "claude-opus-4",
      latestResult: "Found one SDK mismatch.",
    });
  });

  it("omits latestResult outside the completed state", () => {
    expect(activitySubagentToDelegatedWorkFields(subagent()).latestResult).toBeNull();
  });
});
