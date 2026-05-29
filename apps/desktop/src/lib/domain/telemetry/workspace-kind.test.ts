import { describe, expect, it } from "vitest";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { resolveDesktopTelemetryWorkspaceKind } from "./workspace-kind";

describe("resolveDesktopTelemetryWorkspaceKind", () => {
  it("classifies missing workspace selection as none", () => {
    expect(resolveDesktopTelemetryWorkspaceKind(null)).toBe("none");
  });

  it("classifies cloud synthetic workspace ids as cloud", () => {
    expect(resolveDesktopTelemetryWorkspaceKind(
      cloudWorkspaceSyntheticId("cloud-workspace-1"),
    )).toBe("cloud");
  });

  it("classifies regular workspace ids as local", () => {
    expect(resolveDesktopTelemetryWorkspaceKind("workspace-1")).toBe("local");
  });
});
