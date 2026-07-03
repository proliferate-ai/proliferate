import { describe, expect, it } from "vitest";
import { resolveWorkspaceLocationChip } from "./move-location-chip";

describe("resolveWorkspaceLocationChip", () => {
  it("returns null with no workspace selected", () => {
    expect(resolveWorkspaceLocationChip(null, false)).toBeNull();
  });

  it("is clickable for a local workspace", () => {
    expect(resolveWorkspaceLocationChip("workspace-1", false)).toEqual({
      location: "local",
      label: "This Mac",
      clickable: true,
    });
  });

  it("is a read-only badge for a cloud workspace", () => {
    expect(resolveWorkspaceLocationChip("cloud:cloud-ws-1", true)).toEqual({
      location: "cloud",
      label: "Cloud",
      clickable: false,
    });
  });

  it("is a read-only badge for an SSH target workspace", () => {
    expect(resolveWorkspaceLocationChip("target:target-1:ws-1", false)).toEqual({
      location: "target",
      label: "Remote target",
      clickable: false,
    });
  });
});
