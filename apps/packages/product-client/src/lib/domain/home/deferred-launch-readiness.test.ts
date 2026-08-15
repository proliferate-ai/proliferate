import { describe, expect, it } from "vitest";
import {
  awaitingCloudWorkspaceEntryFixture,
  cloudWorkspaceFixture as cloudWorkspace,
} from "#product/test/cloud-workspace-fixtures";
import {
  resolveDeferredLaunchReadiness,
} from "#product/lib/domain/home/deferred-launch-readiness";

const awaitingEntry = () => awaitingCloudWorkspaceEntryFixture("attempt-1", "cloud:cloud-1");

describe("resolveDeferredLaunchReadiness", () => {
  it("waits while the launch's own workspace is still provisioning", () => {
    expect(resolveDeferredLaunchReadiness({
      cloudWorkspace: cloudWorkspace({ status: "pending" }),
      pendingEntry: awaitingEntry(),
    })).toBe("waiting");
  });

  it("promotes as soon as the launch's own workspace is ready", () => {
    expect(resolveDeferredLaunchReadiness({
      cloudWorkspace: cloudWorkspace({ status: "ready" }),
      pendingEntry: awaitingEntry(),
    })).toBe("ready");
  });

  it("takes a failed attempt over the workspace record, which can lag it", () => {
    expect(resolveDeferredLaunchReadiness({
      cloudWorkspace: cloudWorkspace({ status: "pending" }),
      pendingEntry: { ...awaitingEntry(), stage: "failed" },
    })).toBe("failed");
  });

  it("releases the queued prompt when the workspace reaches a terminal status", () => {
    // Without this the launch would wait out the full hour-long staleness
    // timer for a workspace that can never become ready (PRO-230 review
    // finding 4).
    expect(resolveDeferredLaunchReadiness({
      cloudWorkspace: cloudWorkspace({ status: "lost" }),
      pendingEntry: awaitingEntry(),
    })).toBe("failed");
    expect(resolveDeferredLaunchReadiness({
      cloudWorkspace: cloudWorkspace({ status: "archived" }),
      pendingEntry: awaitingEntry(),
    })).toBe("failed");
  });
});
