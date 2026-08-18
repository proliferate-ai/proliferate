import { describe, expect, it } from "vitest";
import {
  mergeLiveDefaultLaunchControls,
  pickLiveDefaultLaunchControls,
} from "#product/lib/domain/sessions/creation/launch-controls";

describe("pickLiveDefaultLaunchControls", () => {
  it("keeps only launch controls that should become live defaults", () => {
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
    });
  });

  // claude's harness names the option `fast`; the live default it feeds is
  // still `fast_mode`, so the raw id has to normalize on the way in.
  it("normalizes claude's raw `fast` id onto fast_mode", () => {
    expect(pickLiveDefaultLaunchControls({ fast: "on" })).toEqual({ fast_mode: "on" });
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
        mode: "ignored",
      },
    })).toEqual({
      codex: {
        reasoning: "high",
        effort: "low",
        collaboration_mode: "solo",
      },
    });
  });

  it("returns the same defaults when no live controls are present", () => {
    const defaults = { codex: { reasoning: "medium" } };

    expect(mergeLiveDefaultLaunchControls({
      defaults,
      agentKind: "codex",
      values: { mode: "ignored" },
    })).toBe(defaults);
  });
});
