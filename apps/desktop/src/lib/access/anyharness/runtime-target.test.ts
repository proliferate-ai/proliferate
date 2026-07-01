import { describe, expect, it } from "vitest";
import { runtimeTargetUsesCloudCommand } from "@/lib/access/anyharness/runtime-target";

describe("runtimeTargetUsesCloudCommand", () => {
  it("keeps cloud sandbox gateway targets on direct AnyHarness access", () => {
    expect(runtimeTargetUsesCloudCommand({
      location: "cloud",
      runtimeAccessKind: "proliferate-gateway",
    })).toBe(false);
  });

  it("keeps legacy cloud targets on cloud commands", () => {
    expect(runtimeTargetUsesCloudCommand({
      location: "cloud",
      runtimeAccessKind: "direct",
    })).toBe(true);
  });

  it("does not route local targets through cloud commands", () => {
    expect(runtimeTargetUsesCloudCommand({
      location: "local",
    })).toBe(false);
  });
});
