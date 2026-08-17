// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainSidebarPageShell } from "#product/components/workspace/shell/screen/MainSidebarPageShell";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";

const mocks = vi.hoisted(() => ({
  sidebarState: {
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
  },
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (
    selector: (state: typeof mocks.sidebarState) => unknown,
  ) => selector(mocks.sidebarState),
}));

vi.mock("#product/hooks/preferences/ui/use-workspace-sidebar-resize", () => ({
  useWorkspaceSidebarResize: () => ({
    sidebarWidth: 260,
    sidebarResizing: false,
    onSidebarSeparatorDown: vi.fn(),
  }),
}));

vi.mock("#product/hooks/ui/layout/use-mac-window-controls", () => ({
  useHasMacWindowControls: () => false,
  useMacWindowControlsInsetClass: () => "",
}));

vi.mock("#product/hooks/theme/derived/use-glass-chrome-canvas", () => ({
  useGlassChromeCanvas: () => undefined,
}));

vi.mock("#product/hooks/theme/derived/use-transparent-chrome", () => ({
  useTransparentChromeEnabled: () => false,
}));

vi.mock("#product/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: null }),
}));

vi.mock("#product/components/workspace/shell/sidebar/MainSidebar", () => ({
  MainSidebar: () => <nav>Main sidebar</nav>,
}));

vi.mock("#product/components/app/sidebar/SidebarUpdateFooterButton", () => ({
  SidebarUpdateFooterButton: () => null,
}));

describe("MainSidebarPageShell", () => {
  beforeEach(() => {
    clearShortcutHandlerRegistryForTests();
    mocks.sidebarState.sidebarOpen = true;
    mocks.sidebarState.setSidebarOpen.mockReset();
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
  });

  it("registers the page shell as the Command/Ctrl+B sidebar owner", () => {
    const { unmount } = render(
      <MainSidebarPageShell>
        <main>Page content</main>
      </MainSidebarPageShell>,
    );

    expect(runShortcutHandler("workspace.toggle-left-sidebar", { source: "keyboard" }))
      .toBe(true);
    expect(mocks.sidebarState.setSidebarOpen).toHaveBeenCalledTimes(1);

    const update = mocks.sidebarState.setSidebarOpen.mock.calls[0][0] as (
      open: boolean,
    ) => boolean;
    expect(update(true)).toBe(false);
    expect(update(false)).toBe(true);

    unmount();
    expect(runShortcutHandler("workspace.toggle-left-sidebar", { source: "keyboard" }))
      .toBe(false);
  });
});
