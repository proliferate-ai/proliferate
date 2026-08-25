import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveRuntimeTargetForWorkspace,
} from "#product/lib/access/anyharness/runtime-target";
import { supportsCallerSelectedSessionCreate } from "#product/lib/access/anyharness/caller-selected-session-create";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveRuntimeTargetForWorkspace", () => {
  it("scopes caller-selected create ids to the bundled local runtime", () => {
    expect(supportsCallerSelectedSessionCreate("workspace-local")).toBe(true);
    expect(supportsCallerSelectedSessionCreate("cloud:workspace-cloud")).toBe(false);
  });

  it("resolves a local workspace against the bundled runtime", async () => {
    const target = await resolveRuntimeTargetForWorkspace(
      "http://runtime.test",
      "workspace-local",
      null,
    );
    expect(target).toMatchObject({
      location: "local",
      baseUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-local",
      runtimeGeneration: 0,
    });
    expect(target).not.toHaveProperty("runtimeAccessKind");
  });
});
