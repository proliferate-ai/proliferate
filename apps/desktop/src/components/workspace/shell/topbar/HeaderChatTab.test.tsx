// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderChatTab } from "@/components/workspace/shell/topbar/HeaderChatTab";
import type { HeaderChatTabEntry } from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

vi.mock("@/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

describe("HeaderChatTab", () => {

  afterEach(cleanup);

  it("activates an inactive tab on primary pointer down and suppresses the follow-up click", () => {
    const onActivate = vi.fn();
    const onPreview = vi.fn();
    let suppressedClickSessionId: string | null = null;

    renderHeaderChatTab({
      tab: buildTab({ isActive: false }),
      onActivate,
      onPreview,
      suppressNextSelectClick: vi.fn((sessionId) => {
        suppressedClickSessionId = sessionId;
      }),
      consumeSuppressedSelectClick: vi.fn((sessionId) => {
        if (suppressedClickSessionId !== sessionId) {
          return false;
        }
        suppressedClickSessionId = null;
        return true;
      }),
    });

    const tab = screen.getByRole("tab", { name: "Session one" });
    fireEvent.pointerDown(tab, { button: 0, isPrimary: true });
    fireEvent.click(tab);

    expect(onPreview).toHaveBeenCalledWith("session-1");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("session-1");
  });
});

function renderHeaderChatTab(overrides: Partial<Parameters<typeof HeaderChatTab>[0]> = {}) {
  const props = {
    tab: buildTab(),
    width: 180,
    position: 0,
    dragOffset: 0,
    isDragging: false,
    canDragTab: true,
    hideLeftDivider: false,
    hideRightDivider: false,
    renamingSessionId: null,
    multiSelectedSessionIds: new Set<string>(),
    selectedTopLevelSessionIds: [],
    onPointerEnter: vi.fn(),
    shouldSuppressClick: vi.fn(() => false),
    onRenameOpenChange: vi.fn(),
    onStartRename: vi.fn(),
    onRename: vi.fn(async () => undefined),
    onCreateGroup: vi.fn(),
    onContextMenuTarget: vi.fn(),
    onFork: vi.fn(),
    onPreview: vi.fn(),
    onActivate: vi.fn(),
    onSuppressSelect: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onDismiss: vi.fn(),
    shortcutLabel: null,
    shortcutRevealVisible: false,
    clearSelection: vi.fn(),
    toggleSelection: vi.fn(),
    suppressNextSelectClick: vi.fn(),
    consumeSuppressedSelectClick: vi.fn(() => false),
    ...overrides,
  };

  return render(<HeaderChatTab {...props} />);
}

function buildTab(overrides: Partial<HeaderChatTabEntry> = {}): HeaderChatTabEntry {
  return {
    id: "session-1",
    sessionId: "session-1",
    title: "Session one",
    agentKind: "claude",
    viewState: "idle",
    canFork: true,
    isReviewAgentChild: false,
    source: null,
    sessionLinkId: null,
    workspaceId: "workspace-1",
    isActive: true,
    hasUnreadActivity: false,
    groupColor: null,
    visualGroupId: null,
    manualGroupId: null,
    isHierarchyResolved: true,
    isResolvingSession: false,
    delegatedAgent: null,
    parentSessionId: null,
    groupRootSessionId: "session-1",
    isChild: false,
    ...overrides,
  };
}
