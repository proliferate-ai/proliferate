/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShellRightRail } from "#product/components/workspace/shell/screen/WorkspaceShellRightRail";
import { DEFAULT_RIGHT_PANEL_WORKSPACE_STATE } from "#product/lib/domain/workspaces/shell/right-panel-model";

vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/shell/right-panel/RightPanel", () => ({
  RightPanel: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="right-panel" data-open={String(isOpen)} />
  ),
}));

vi.mock("#product/components/workspace/shell/screen/WorkspaceResizeSeparator", () => ({
  WorkspaceResizeSeparator: () => <div data-testid="right-separator" />,
}));

const RIGHT_PANEL_PROPS = {
  workspaceId: "workspace-1",
  workspaceUiKey: "workspace-1",
  isWorkspaceReady: true,
  shouldKeepContentVisible: true,
  isCloudWorkspaceSelected: false,
  state: DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  repoSettingsHref: "/settings",
  onStateChange: vi.fn(),
  terminalActivationRequest: null,
  onTerminalActivationRequestHandled: vi.fn(),
};

describe("WorkspaceShellRightRail", () => {
  afterEach(cleanup);

  it("anchors panel content to the fixed right edge under the animated rail clip", () => {
    const { container, getByTestId } = render(
      <WorkspaceShellRightRail
        visible
        open
        width={420}
        onSeparatorMouseDown={() => {}}
        {...RIGHT_PANEL_PROPS}
      />,
    );

    const rail = container.querySelector<HTMLElement>("[data-right-panel-rail]");
    const content = container.querySelector<HTMLElement>("[data-right-panel-content]");
    // The animated width var clamped so the chat pane keeps its minimum: the
    // rail yields before the composer collapses (MAIN_PANE_MIN_WIDTH).
    expect(rail?.style.width).toBe(
      "min(var(--workspace-right-width), calc(100% - 440px))",
    );
    expect(rail?.className).toContain("bg-sidebar-background");
    expect(content?.className).toContain("absolute inset-y-0 right-0");
    expect(content?.className).toContain("opacity-100");
    expect(content?.style.width).toBe("420px");
    expect(getByTestId("right-panel").dataset.open).toBe("true");
    expect(getByTestId("right-separator")).toBeTruthy();
  });

  it("keeps the closing content mounted, stationary, inert, and fading", () => {
    const { container, getByTestId } = render(
      <WorkspaceShellRightRail
        visible
        open={false}
        width={420}
        onSeparatorMouseDown={() => {}}
        {...RIGHT_PANEL_PROPS}
      />,
    );

    const content = container.querySelector<HTMLElement>("[data-right-panel-content]");
    expect(content?.className).toContain("right-0");
    expect(content?.className).toContain("opacity-0");
    expect(content?.className).not.toContain("translate");
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(getByTestId("right-panel").dataset.open).toBe("false");
  });
});
