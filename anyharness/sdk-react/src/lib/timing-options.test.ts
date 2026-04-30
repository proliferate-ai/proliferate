import { describe, expect, it } from "vitest";

import { anyHarnessSessionsKey } from "./query-keys.js";
import { resolveAnyHarnessCacheDecision } from "./timing-options.js";

describe("sdk-react timing options", () => {
  it("keeps request timing options out of query keys", () => {
    const baseKey = anyHarnessSessionsKey("http://runtime.test", "workspace-1");
    const withTimingAvailable = anyHarnessSessionsKey("http://runtime.test", "workspace-1");

    expect(withTimingAvailable).toEqual(baseKey);
  });

  it("resolves cache decisions without user data labels", () => {
    expect(resolveAnyHarnessCacheDecision(false, undefined)).toBe("skipped");
    expect(resolveAnyHarnessCacheDecision(true, undefined)).toBe("miss");
    expect(resolveAnyHarnessCacheDecision(true, {
      dataUpdatedAt: 1,
      isInvalidated: false,
    })).toBe("hit");
    expect(resolveAnyHarnessCacheDecision(true, {
      dataUpdatedAt: 1,
      isInvalidated: true,
    })).toBe("stale");
  });
});
