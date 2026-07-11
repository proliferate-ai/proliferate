import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStagedReplacedSessionTombstone,
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  shouldEnableHeaderSessionScopedQuery,
} from "./use-workspace-header-subagent-hierarchy";

beforeEach(() => {
  resetReplacedSessionTombstonesForTests();
});

describe("header session-scoped query eligibility", () => {
  it("disables every query family for a tombstoned session and re-enables after rollback", () => {
    const input = {
      workspaceId: "workspace-1",
      sessionId: "runtime-old",
      materializedSessionId: "runtime-old",
      enabledByBatch: true,
    };

    expect(shouldEnableHeaderSessionScopedQuery(input)).toBe(true);

    stageReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(shouldEnableHeaderSessionScopedQuery(input)).toBe(false);

    clearStagedReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(shouldEnableHeaderSessionScopedQuery(input)).toBe(true);
  });
});
