import { describe, expect, it } from "vitest";
import {
  type HotPaintGate,
  isHotPaintGatePendingForWorkspace,
} from "./hot-paint-gate";

const gate: HotPaintGate = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
  nonce: 1,
  operationId: null,
  kind: "session_hot_switch",
};

describe("hot paint gate", () => {
  it("matches the gated workspace", () => {
    expect(isHotPaintGatePendingForWorkspace(gate, "workspace-1")).toBe(true);
  });

  it("does not match another workspace", () => {
    expect(isHotPaintGatePendingForWorkspace(gate, "workspace-2")).toBe(false);
  });

  it("does not match nullish workspaces", () => {
    expect(isHotPaintGatePendingForWorkspace(gate, null)).toBe(false);
    expect(isHotPaintGatePendingForWorkspace(gate, undefined)).toBe(false);
  });

  it("does not match a null gate", () => {
    expect(isHotPaintGatePendingForWorkspace(null, "workspace-1")).toBe(false);
  });
});
