import { describe, expect, it } from "vitest";
import {
  DETACHED_DIRECT_RUNTIME_CONNECTION,
  directAuthSyncTargetIds,
  directRuntimeConnectionKey,
  directRuntimeTransport,
  loopbackDirectRuntimeConnectionState,
  loopbackDirectRuntimeRef,
  reduceDirectRuntimeConnection,
  sshDirectRuntimeRef,
  type DirectRuntimeConnectionSnapshot,
} from "./direct-runtime";

describe("direct runtime refs", () => {
  it("derives loopback transport from a null target id", () => {
    expect(directRuntimeTransport(null)).toBe("loopback");
    expect(directRuntimeTransport("target-1")).toBe("ssh");
  });

  it("builds a loopback ref for this machine", () => {
    expect(loopbackDirectRuntimeRef()).toEqual({
      targetId: null,
      transport: "loopback",
      displayName: "This Mac",
    });
  });

  it("builds an ssh ref with the target id as the fallback display name", () => {
    expect(sshDirectRuntimeRef("target-1")).toEqual({
      targetId: "target-1",
      transport: "ssh",
      displayName: "target-1",
    });
    expect(sshDirectRuntimeRef("target-1", "Home server").displayName).toBe(
      "Home server",
    );
  });

  it("keys loopback and targets without collisions", () => {
    expect(directRuntimeConnectionKey(null)).toBe("loopback");
    expect(directRuntimeConnectionKey("loopback")).toBe("target:loopback");
    expect(directRuntimeConnectionKey("target-1")).toBe("target:target-1");
  });
});

describe("directAuthSyncTargetIds", () => {
  it("is loopback-only before the targets query settles", () => {
    expect(directAuthSyncTargetIds(undefined)).toEqual([null]);
    expect(directAuthSyncTargetIds([])).toEqual([null]);
  });

  it("appends enrolled ssh targets after the loopback runtime", () => {
    expect(
      directAuthSyncTargetIds([
        { id: "t-ssh-1", kind: "ssh", status: "online" },
        { id: "t-ssh-2", kind: "ssh", status: "offline" },
      ]),
    ).toEqual([null, "t-ssh-1", "t-ssh-2"]);
  });

  it("excludes archived and non-ssh targets", () => {
    expect(
      directAuthSyncTargetIds([
        { id: "t-archived", kind: "ssh", status: "archived" },
        { id: "t-cloud", kind: "managed_cloud", status: "online" },
        { id: "t-dispatch", kind: "desktop_dispatch", status: "online" },
        { id: "t-ssh", kind: "ssh", status: "enrolling" },
      ]),
    ).toEqual([null, "t-ssh"]);
  });
});

describe("loopbackDirectRuntimeConnectionState", () => {
  it("maps harness bootstrap health onto the direct connection states", () => {
    expect(loopbackDirectRuntimeConnectionState("healthy")).toBe("attached");
    expect(loopbackDirectRuntimeConnectionState("connecting")).toBe("connecting");
    expect(loopbackDirectRuntimeConnectionState("failed")).toBe("unreachable");
  });
});

describe("reduceDirectRuntimeConnection", () => {
  const attached: DirectRuntimeConnectionSnapshot = {
    connectionState: "attached",
    baseUrl: "http://127.0.0.1:52001",
    authToken: "bearer-1",
    lastError: null,
  };

  it("moves detached to connecting on connect_started", () => {
    expect(
      reduceDirectRuntimeConnection(DETACHED_DIRECT_RUNTIME_CONNECTION, {
        type: "connect_started",
      }),
    ).toEqual({
      connectionState: "connecting",
      baseUrl: null,
      authToken: null,
      lastError: null,
    });
  });

  it("keeps the last resolved connection while reconnecting", () => {
    expect(
      reduceDirectRuntimeConnection(attached, { type: "connect_started" }),
    ).toEqual({ ...attached, connectionState: "connecting" });
  });

  it("records the resolved connection and clears errors on attach", () => {
    const unreachable = reduceDirectRuntimeConnection(
      DETACHED_DIRECT_RUNTIME_CONNECTION,
      { type: "attach_failed", error: "tunnel failed" },
    );
    expect(
      reduceDirectRuntimeConnection(unreachable, {
        type: "attached",
        baseUrl: "http://127.0.0.1:52001",
        authToken: "bearer-1",
      }),
    ).toEqual(attached);
  });

  it("drops the resolved connection and records the error on failure", () => {
    expect(
      reduceDirectRuntimeConnection(attached, {
        type: "attach_failed",
        error: "tunnel failed",
      }),
    ).toEqual({
      connectionState: "unreachable",
      baseUrl: null,
      authToken: null,
      lastError: "tunnel failed",
    });
  });

  it("resets fully on detach", () => {
    expect(
      reduceDirectRuntimeConnection(attached, { type: "detached" }),
    ).toEqual(DETACHED_DIRECT_RUNTIME_CONNECTION);
  });
});
