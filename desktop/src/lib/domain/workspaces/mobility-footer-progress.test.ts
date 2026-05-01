import { describe, expect, it } from "vitest";
import { resolveMobilityFooterProgressStatus } from "@/lib/domain/workspaces/mobility-footer-progress";

describe("resolveMobilityFooterProgressStatus", () => {
  it("does not treat preflight preparation as move progress", () => {
    expect(resolveMobilityFooterProgressStatus({
      canBringBackLocal: false,
      canMoveToCloud: true,
      confirmDirection: "local_to_cloud",
      optimisticProgressDirection: null,
      statusDirection: null,
      statusPhase: "idle",
    })).toBeNull();
  });

  it("shows optimistic progress immediately after confirmation", () => {
    expect(resolveMobilityFooterProgressStatus({
      canBringBackLocal: false,
      canMoveToCloud: true,
      confirmDirection: "local_to_cloud",
      optimisticProgressDirection: "local_to_cloud",
      statusDirection: null,
      statusPhase: "idle",
    })).toEqual({
      title: "Moving to cloud",
      statusLabel: "Preparing cloud workspace",
    });
  });

  it("uses the real transition phase once server status arrives", () => {
    expect(resolveMobilityFooterProgressStatus({
      canBringBackLocal: false,
      canMoveToCloud: true,
      confirmDirection: "local_to_cloud",
      optimisticProgressDirection: "local_to_cloud",
      statusDirection: "local_to_cloud",
      statusPhase: "transferring",
    })).toEqual({
      title: "Moving to cloud",
      statusLabel: "Syncing workspace",
    });
  });
});
