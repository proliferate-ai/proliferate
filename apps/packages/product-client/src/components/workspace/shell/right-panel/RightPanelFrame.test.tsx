/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightPanelFrame } from "#product/components/workspace/shell/right-panel/RightPanelFrame";

// RightPanelFrame's geometry contract (spec "02A - Docked File Tree",
// Geometry and responsive behavior): `WorkspaceShellRightRail`'s absolute
// 1px left divider is a paint-only overlay that consumes no layout width, so
// `RightPanelFrame`'s own `border-l` is the *sole* 1px layout cost inside the
// rail's border box. jsdom does not compute real layout/`clientWidth`, so
// this suite pins the source contract (the border class exists exactly once,
// on the frame root, and content/tabs never duplicate it); the actual
// 781/780 and 661/660 `clientWidth` pairs are proved in the qualification
// browser suite.

vi.mock("#product/components/workspace/shell/right-panel/RightPanelHeaderTabs", () => ({
  RightPanelHeaderTabs: () => <div data-testid="right-panel-header-tabs" />,
}));

vi.mock("#product/components/workspace/shell/right-panel/RightPanelContent", () => ({
  RightPanelContent: () => <div data-testid="right-panel-content" />,
}));

const BASE_PROPS = {
  onPointerDownCapture: () => {},
  workspaceId: "workspace-1",
  workspaceUiKey: "workspace-1",
  activeEntryKey: "tool:scratch" as const,
  activeTool: null,
  isOpen: true,
  activeTerminalId: null,
  activeViewerTarget: null,
  entries: [],
  backgroundWorkDirty: false,
  unreadByTerminal: {},
  buffersByPath: {},
  tabModes: {},
  orderedTerminals: [],
  isWorkspaceReady: true,
  shouldRenderContent: true,
  shouldMountTerminalPanel: false,
  canConnectTerminals: true,
  isLoadingTerminals: false,
  terminalListErrorMessage: null,
  terminalFocusRequestToken: 0,
  newTabMenuRequestToken: 0,
  newTabMenuDefaultKind: "terminal" as const,
  onActivateEntry: () => true,
  onSelectTerminal: () => {},
  onCloseTerminal: () => {},
  onCloseViewerTarget: () => {},
  onRenameTerminal: async () => {},
  onCreateTerminal: () => {},
  onOpenRepoSettings: () => {},
  onReorderHeaderEntry: () => {},
};

function renderFrame() {
  const rootRef = createRef<HTMLDivElement>();
  const result = render(<RightPanelFrame rootRef={rootRef} {...BASE_PROPS} />);
  return { ...result, rootRef };
}

afterEach(cleanup);

describe("RightPanelFrame geometry", () => {
  it("owns exactly one border-l layout cost on its root, not on header/content", () => {
    const { rootRef } = renderFrame();
    const root = rootRef.current as HTMLDivElement;

    expect(root.className).toContain("border-l");
    // Only one occurrence of the inline-start border utility on the root.
    expect(root.className.match(/\bborder-l\b/g)).toHaveLength(1);
  });

  it("marks the root as the rail's rendered content, not a second rail wrapper", () => {
    const { rootRef } = renderFrame();
    const root = rootRef.current as HTMLDivElement;

    expect(root.getAttribute("data-right-panel-root")).toBe("true");
    // The rail's own `[data-right-panel-rail]` and paint-only divider live
    // one level up in `WorkspaceShellRightRail`; the frame never renders a
    // second rail attribute or a second absolute divider overlay.
    expect(root.querySelector("[data-right-panel-rail]")).toBeNull();
  });

  it("gives the frame a full-height flex column so its border-box is the layout box measured for geometry", () => {
    const { rootRef } = renderFrame();
    const root = rootRef.current as HTMLDivElement;

    expect(root.className).toContain("flex");
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("overflow-hidden");
  });
});
