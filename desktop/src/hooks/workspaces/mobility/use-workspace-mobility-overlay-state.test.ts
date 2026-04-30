import { describe, expect, it } from "vitest";
import { resolveCompletionDirection } from "./use-workspace-mobility-overlay-state";

describe("resolveCompletionDirection", () => {
  it("keeps the completed handoff direction after active handoff state clears", () => {
    expect(resolveCompletionDirection({
      effectiveOwner: "local",
      snapshot: {
        description: "This workspace has moved back to your local machine.",
        direction: "cloud_to_local",
        title: "Now local",
      },
      statusDirection: null,
    })).toBe("cloud_to_local");
  });

  it("falls back to the authoritative owner when no completion snapshot is available", () => {
    expect(resolveCompletionDirection({
      effectiveOwner: "local",
      snapshot: null,
      statusDirection: null,
    })).toBe("cloud_to_local");

    expect(resolveCompletionDirection({
      effectiveOwner: "cloud",
      snapshot: null,
      statusDirection: null,
    })).toBe("local_to_cloud");
  });
});
