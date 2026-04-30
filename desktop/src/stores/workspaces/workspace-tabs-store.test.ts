import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceTabsStore } from "./workspace-tabs-store";

describe("workspace tabs store", () => {
  beforeEach(() => {
    useWorkspaceTabsStore.getState().reset();
  });

  it("does not notify when setting an unchanged active shell tab key", () => {
    const listener = vi.fn();
    useWorkspaceTabsStore.getState().setActiveShellTabKey("workspace-1", "chat:session-1");
    const unsubscribe = useWorkspaceTabsStore.subscribe(listener);

    useWorkspaceTabsStore.getState().setActiveShellTabKey("workspace-1", "chat:session-1");

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not notify when setting an unchanged shell tab order", () => {
    const order = ["chat:session-1", "file:src/App.tsx"];
    const listener = vi.fn();
    useWorkspaceTabsStore.getState().setShellTabOrder("workspace-1", order);
    const unsubscribe = useWorkspaceTabsStore.subscribe(listener);

    useWorkspaceTabsStore.getState().setShellTabOrder("workspace-1", [...order]);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not notify when setting an empty missing shell tab order", () => {
    const listener = vi.fn();
    const unsubscribe = useWorkspaceTabsStore.subscribe(listener);

    useWorkspaceTabsStore.getState().setShellTabOrder("workspace-1", []);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
