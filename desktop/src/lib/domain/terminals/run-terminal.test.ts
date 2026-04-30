import { describe, expect, it } from "vitest";
import { findReusableRunTerminalId } from "@/lib/domain/terminals/run-terminal";

describe("run terminal helpers", () => {
  it("reuses a running or starting Run terminal in the same workspace", () => {
    const tabs = [
      {
        id: "other",
        workspaceId: "workspace-1",
        title: "Run",
        purpose: "general",
        status: "running",
      },
      {
        id: "wrong-workspace",
        workspaceId: "workspace-2",
        title: "Run",
        purpose: "run",
        status: "running",
      },
      {
        id: "exited",
        workspaceId: "workspace-1",
        title: "Run",
        purpose: "run",
        status: "exited",
      },
      {
        id: "run",
        workspaceId: "workspace-1",
        title: "Renamed run terminal",
        purpose: "run",
        status: "starting",
      },
    ];

    expect(findReusableRunTerminalId(tabs, "workspace-1")).toBe("run");
  });

  it("does not reuse exited or failed Run terminals", () => {
    const tabs = [
      {
        id: "exited",
        workspaceId: "workspace-1",
        title: "Renamed",
        purpose: "run",
        status: "exited",
      },
      {
        id: "failed",
        workspaceId: "workspace-1",
        title: "Run",
        purpose: "run",
        status: "failed",
      },
    ];

    expect(findReusableRunTerminalId(tabs, "workspace-1")).toBeNull();
  });

  it("does not reuse title-only Run terminals", () => {
    const tabs = [
      { id: "legacy", workspaceId: "workspace-1", title: "Run", status: "running" },
    ];

    expect(findReusableRunTerminalId(tabs, "workspace-1")).toBeNull();
  });
});
