import { describe, expect, it } from "vitest";
import { buildSelectedCloudRuntimeViewModel } from "./cloud-runtime-state";

describe("cloud runtime state", () => {
  it("requires a claim before direct attachment for shared unclaimed workspaces", () => {
    expect(buildSelectedCloudRuntimeViewModel({
      persistedStatus: "ready",
      visibility: "shared_unclaimed",
      connectionState: "ready",
      isWarm: false,
    })).toMatchObject({
      phase: "claim_required",
      title: "Shared workspace unclaimed",
      showClaim: true,
      showRetry: false,
      preserveVisibleContent: false,
    });
  });

  it("does not show a claim action for private ready workspaces", () => {
    expect(buildSelectedCloudRuntimeViewModel({
      persistedStatus: "ready",
      visibility: "private",
      connectionState: "ready",
      isWarm: false,
    })).toMatchObject({
      phase: "ready",
      showClaim: false,
      showRetry: false,
    });
  });
});
