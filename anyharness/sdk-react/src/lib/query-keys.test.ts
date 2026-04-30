import { describe, expect, it } from "vitest";

import { anyHarnessSessionEventsKey } from "./query-keys.js";

describe("sdk-react query keys", () => {
  it("uses a session-events scope key for broad invalidation", () => {
    expect(
      anyHarnessSessionEventsKey("http://runtime.test", "workspace-1", "session-1"),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "session",
      "workspace-1",
      "session-1",
      "events",
    ]);
  });

  it("includes every event request field that changes the result", () => {
    expect(
      anyHarnessSessionEventsKey(
        "http://runtime.test",
        "workspace-1",
        "session-1",
        12,
        100,
        8,
        6,
      ),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "session",
      "workspace-1",
      "session-1",
      "events",
      {
        afterSeq: 12,
        beforeSeq: 8,
        limit: 100,
        turnLimit: 6,
      },
    ]);
  });
});
