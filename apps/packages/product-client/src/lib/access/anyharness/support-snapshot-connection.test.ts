import { describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";
import {
  resolveSupportSnapshotAccess,
} from "#product/lib/access/anyharness/support-snapshot-connection";
import type {
  ResolveSupportSnapshotAccessInput,
} from "#product/lib/domain/support/support-snapshot-access-contract";

function runtime(
  url = "http://127.0.0.1:4477",
  status: "healthy" | "starting" | "failed" | "stopped" = "healthy",
): DesktopRuntimeBridge {
  return {
    getConnection: vi.fn().mockResolvedValue({ connection: { runtimeUrl: url }, status }),
    restart: vi.fn(),
  };
}

function input(
  overrides: Partial<ResolveSupportSnapshotAccessInput> = {},
): ResolveSupportSnapshotAccessInput {
  return {
    selection: "recent_activity",
    capturedRuntime: { url: "http://127.0.0.1:4477/", source: "native_capture" },
    selectedWorkspace: {
      kind: "bundled_local",
      workspaceId: "workspace-1",
      anyharnessWorkspaceId: "runtime-workspace-1",
    },
    runtime: runtime(),
    ...overrides,
  };
}

describe("support-only bundled-local resolution", () => {
  it("returns a branded exact bundled-local binding", async () => {
    const result = await resolveSupportSnapshotAccess(input());
    expect(result).toMatchObject({
      state: "resolved",
      connection: {
        runtimeUrl: "http://127.0.0.1:4477",
        anyharnessWorkspaceId: "runtime-workspace-1",
      },
      selection: {
        kind: "recent_activity",
        workspace: { workspaceId: "workspace-1" },
      },
    });
  });

  it.each(["cloud", "ssh", "standalone", "supervisor_owned"] as const)(
    "never accepts a %s workspace",
    async (kind) => {
      const result = await resolveSupportSnapshotAccess(input({
        selectedWorkspace: { kind, workspaceId: "workspace-1" },
      }));
      expect(result).toEqual({
        state: "none",
        binding: { kind: "none", reason: "no_selected_bundled_local_workspace" },
      });
    },
  );

  it("does not accept default fallback, URL mismatch, unhealthy, or absent native capability", async () => {
    expect(await resolveSupportSnapshotAccess(input({
      capturedRuntime: { url: "http://127.0.0.1:4477", source: "default_fallback" },
    }))).toMatchObject({ state: "none" });
    expect(await resolveSupportSnapshotAccess(input({
      capturedRuntime: { url: "https://runtime.example.com", source: "native_capture" },
      runtime: runtime("https://runtime.example.com"),
    }))).toMatchObject({ state: "none" });
    expect(await resolveSupportSnapshotAccess(input({ runtime: runtime("http://localhost:4478") })))
      .toMatchObject({ state: "none" });
    expect(await resolveSupportSnapshotAccess(input({ runtime: runtime(undefined, "starting") })))
      .toMatchObject({ state: "none" });
    expect(await resolveSupportSnapshotAccess(input({ runtime: null })))
      .toMatchObject({ state: "none" });
  });

  it("requires an exact active directory ownership/materialization mapping", async () => {
    const base = input({
      selection: "active_session",
      activeSession: {
        uiSessionId: "ui-session-1",
        directoryWorkspaceId: "workspace-1",
        materializedSessionId: "runtime-session-1",
      },
    });
    expect(await resolveSupportSnapshotAccess(base)).toMatchObject({
      state: "resolved",
      selection: {
        kind: "active_session",
        uiSessionId: "ui-session-1",
        materializedSessionId: "runtime-session-1",
      },
    });
    expect(await resolveSupportSnapshotAccess({
      ...base,
      activeSession: { ...base.activeSession!, directoryWorkspaceId: "workspace-2" },
    })).toEqual({ state: "ineligible", reason: "session_mapping_stale" });
    expect(await resolveSupportSnapshotAccess({
      ...base,
      activeSession: { ...base.activeSession!, materializedSessionId: " padded " },
    })).toEqual({ state: "ineligible", reason: "session_mapping_stale" });
  });
});
