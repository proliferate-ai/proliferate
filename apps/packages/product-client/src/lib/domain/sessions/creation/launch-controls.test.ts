import { describe, expect, it } from "vitest";
import {
  mergeLiveDefaultLaunchControls,
  pickLiveDefaultLaunchControls,
} from "#product/lib/domain/sessions/creation/launch-controls";

describe("pickLiveDefaultLaunchControls", () => {
  it("preserves every exact observed control id and non-empty value", () => {
    expect(pickLiveDefaultLaunchControls({
      collaboration_mode: "solo",
      reasoning: "high",
      effort: "",
      fast_mode: "enabled",
      mode: "danger",
      access_mode: "read-only",
    })).toEqual({
      collaboration_mode: "solo",
      reasoning: "high",
      fast_mode: "enabled",
      mode: "danger",
      access_mode: "read-only",
    });
  });

  it("does not alias an observed raw control id", () => {
    expect(pickLiveDefaultLaunchControls({ reasoning_effort: "high" })).toEqual({
      reasoning_effort: "high",
    });
  });

  it("returns an empty object for missing values", () => {
    expect(pickLiveDefaultLaunchControls(undefined)).toEqual({});
  });
});

describe("mergeLiveDefaultLaunchControls", () => {
  it("overlays picked controls for the requested agent", () => {
    expect(mergeLiveDefaultLaunchControls({
      defaults: {
        codex: {
          reasoning: "medium",
          effort: "low",
        },
      },
      agentKind: "codex",
      values: {
        reasoning: "high",
        collaboration_mode: "solo",
        mode: "agent",
      },
    })).toEqual({
      codex: {
        reasoning: "high",
        effort: "low",
        collaboration_mode: "solo",
        mode: "agent",
      },
    });
  });

  it("returns the same defaults when no live controls are present", () => {
    const defaults = { codex: { reasoning: "medium" } };

    expect(mergeLiveDefaultLaunchControls({
      defaults,
      agentKind: "codex",
      values: { mode: "" },
    })).toBe(defaults);
  });
});
