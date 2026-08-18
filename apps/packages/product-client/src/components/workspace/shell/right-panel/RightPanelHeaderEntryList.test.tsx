// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RightPanelHeaderEntry } from "#product/lib/domain/workspaces/shell/right-panel-header-entry";
import { rightPanelToolHeaderKey } from "#product/lib/domain/workspaces/shell/right-panel-model";
import type { RightPanelHeaderDragController } from "#product/hooks/workspaces/ui/use-right-panel-header-drag";
import { RightPanelHeaderEntryList } from "#product/components/workspace/shell/right-panel/RightPanelHeaderEntryList";

afterEach(cleanup);

// Minimal stub — this component only reads drag state per entry key and
// fires a handful of callbacks; none of them are exercised by the
// `dirty && !isActive` gate under test.
function makeDrag(): RightPanelHeaderDragController {
  return {
    draggedHeaderKey: null,
    showEndDropIndicator: false,
    getEntryDragState: () => ({ isDragging: false, dragOffsetX: 0, showDropIndicator: false }),
    registerHeaderEntryNode: vi.fn(),
    handleHeaderPointerDown: vi.fn(),
    handleHeaderPointerMove: vi.fn(),
    finishHeaderPointerDrag: vi.fn(),
    cancelHeaderPointerDrag: vi.fn(),
    shouldSuppressHeaderClick: () => false,
  };
}

function renderEntryList(props: {
  entries: readonly RightPanelHeaderEntry[];
  activeEntryKey: string;
  backgroundWorkDirty: boolean;
}) {
  return render(
    <RightPanelHeaderEntryList
      entries={props.entries}
      activeEntryKey={props.activeEntryKey}
      backgroundWorkDirty={props.backgroundWorkDirty}
      unreadByTerminal={{}}
      buffersByPath={{}}
      tabModes={{}}
      isWorkspaceReady
      drag={makeDrag()}
      shortcutRevealVisible={false}
      onActivateEntry={() => true}
      onCloseTerminal={vi.fn()}
      onCloseViewerTarget={vi.fn()}
      onRenameTerminal={vi.fn()}
    />,
  );
}

function dotFor(entryLabel: string): Element | null {
  const tab = screen.getByRole("tab", { name: entryLabel });
  return tab.querySelector(".rounded-full");
}

describe("RightPanelHeaderEntryList — background work dot gate", () => {
  // Manifest rule (see the inline comment in RightPanelHeaderEntryList.tsx):
  // "never render [the dirty dot] on the active entry" — belt-and-suspenders
  // alongside the store-level clear-on-select. Dedicated component-level
  // coverage per R5 review round 2 MINOR #5 (previously only exercised
  // indirectly, if at all, through the tracker/derive-signal unit tests).
  it("does not render the dot on the Background work entry while it is active, even when dirty", () => {
    const entries: RightPanelHeaderEntry[] = [
      { kind: "tool", key: rightPanelToolHeaderKey("background"), tool: "background" },
    ];
    renderEntryList({
      entries,
      activeEntryKey: rightPanelToolHeaderKey("background"),
      backgroundWorkDirty: true,
    });

    expect(dotFor("Background work")).toBeNull();
  });

  it("renders the dot on the Background work entry when dirty and inactive", () => {
    const entries: RightPanelHeaderEntry[] = [
      { kind: "tool", key: rightPanelToolHeaderKey("background"), tool: "background" },
      { kind: "tool", key: rightPanelToolHeaderKey("scratch"), tool: "scratch" },
    ];
    renderEntryList({
      entries,
      // Some OTHER entry is active — Background work is not.
      activeEntryKey: rightPanelToolHeaderKey("scratch"),
      backgroundWorkDirty: true,
    });

    const dot = dotFor("Background work");
    expect(dot?.className).toContain("bg-current");
  });

  it("never marks a non-background tool entry dirty, regardless of backgroundWorkDirty or active state", () => {
    const entries: RightPanelHeaderEntry[] = [
      { kind: "tool", key: rightPanelToolHeaderKey("background"), tool: "background" },
      { kind: "tool", key: rightPanelToolHeaderKey("scratch"), tool: "scratch" },
      { kind: "tool", key: rightPanelToolHeaderKey("git"), tool: "git" },
    ];
    renderEntryList({
      entries,
      // Background work itself is active, so its own dot is suppressed by
      // the active gate anyway — the point of this test is the OTHER tools.
      activeEntryKey: rightPanelToolHeaderKey("background"),
      backgroundWorkDirty: true,
    });

    expect(dotFor("Scratch")).toBeNull();
    expect(dotFor("Changes")).toBeNull();
  });
});
