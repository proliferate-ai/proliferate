import { describe, expect, it } from "vitest";
import { findReusableRunTerminalId } from "@/lib/domain/terminals/run-terminal";

describe("run terminal helpers", () => {
  it("reuses a running or starting Run terminal in the same workspace", () => {
    const tabs = [
      { id: "other", workspaceId: "workspace-1", title: "Terminal", status: "running" },
      { id: "wrong-workspace", workspaceId: "workspace-2", title: "Run", status: "running" },
      { id: "exited", workspaceId: "workspace-1", title: "Run", status: "exited" },
      { id: "run", workspaceId: "workspace-1", title: "Run", status: "starting" },
    ];

    expect(findReusableRunTerminalId(tabs, "workspace-1")).toBe("run");
  });

  it("does not reuse exited or failed Run terminals", () => {
    const tabs = [
      { id: "exited", workspaceId: "workspace-1", title: "Run", status: "exited" },
      { id: "failed", workspaceId: "workspace-1", title: "Run", status: "failed" },
    ];

    expect(findReusableRunTerminalId(tabs, "workspace-1")).toBeNull();
  });
});
