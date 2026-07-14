// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";

import { GlobalHeader } from "./GlobalHeader";

const mocks = vi.hoisted(() => ({
  files: null as null | {
    listOpenTargets: ReturnType<typeof vi.fn>;
    openTarget: ReturnType<typeof vi.fn>;
  },
  clipboardWriteText: vi.fn().mockResolvedValue(undefined),
  preferredTargetId: "",
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: mocks.clipboardWriteText },
    desktop: mocks.files ? { files: mocks.files } : null,
  }),
}));

vi.mock("@/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (selector: (state: { defaultOpenInTargetId: string }) => unknown) =>
    selector({ defaultOpenInTargetId: mocks.preferredTargetId }),
}));

vi.mock("@/components/workspace/shell/topbar/HeaderTabs", () => ({
  HeaderTabs: () => null,
}));

vi.mock("@/components/workspace/shell/topbar/WorkspaceActionsMenuContainer", () => ({
  WorkspaceActionsMenuContainer: () => null,
}));

vi.mock("@/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/workspace/open-target/SplitButton", () => ({
  SplitButton: ({
    onClick,
    onTargetClick,
    targets,
  }: {
    onClick?: () => void;
    onTargetClick?: (target: OpenTarget) => void;
    targets?: OpenTarget[];
  }) => (
    <>
      <button type="button" onClick={onClick}>Open native target</button>
      {targets?.map((target) => (
        <button
          key={target.id}
          type="button"
          onClick={() => onTargetClick?.(target)}
        >
          {target.label}
        </button>
      ))}
    </>
  ),
}));

vi.mock("@/hooks/ui/debug/use-debug-render-count", () => ({
  useDebugRenderCount: () => undefined,
}));

function renderHeader() {
  return render(
    <GlobalHeader
      selectedWorkspace={undefined}
      workspacePath="/repo"
      rightPanelOpen
      onRun={vi.fn()}
      onTogglePanel={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.files = null;
  mocks.preferredTargetId = "";
});

describe("GlobalHeader", () => {
  it("does not offer a native open action without a Desktop file bridge", () => {
    renderHeader();

    expect(screen.queryByRole("button", { name: "Open native target" })).toBeNull();
  });

  it("offers the native open action when the Desktop file bridge is available", () => {
    mocks.files = {
      listOpenTargets: vi.fn().mockResolvedValue([]),
      openTarget: vi.fn().mockResolvedValue(undefined),
    };

    renderHeader();

    expect(screen.getByRole("button", { name: "Open native target" })).toBeTruthy();
  });

  it("routes both preferred and menu copy targets through the shared clipboard", async () => {
    const copyTarget: OpenTarget = {
      id: "copy-path",
      label: "Copy path",
      kind: "copy",
    };
    mocks.preferredTargetId = copyTarget.id;
    mocks.files = {
      listOpenTargets: vi.fn().mockResolvedValue([copyTarget]),
      openTarget: vi.fn().mockResolvedValue(undefined),
    };

    renderHeader();
    const menuCopyButton = await screen.findByRole("button", { name: "Copy path" });

    fireEvent.click(screen.getByRole("button", { name: "Open native target" }));
    fireEvent.click(menuCopyButton);

    await waitFor(() => {
      expect(mocks.clipboardWriteText).toHaveBeenCalledTimes(2);
    });
    expect(mocks.clipboardWriteText).toHaveBeenNthCalledWith(1, "/repo");
    expect(mocks.clipboardWriteText).toHaveBeenNthCalledWith(2, "/repo");
    expect(mocks.files.openTarget).not.toHaveBeenCalled();
  });
});
