import { describe, expect, it } from "vitest";
import {
  partitionSessionTabsForOverflow,
  resolveSessionTabReservedWidth,
  type SessionTabOverflowItem,
} from "@/lib/domain/chat/tab-overflow";

function tabs(count: number, width = 100): SessionTabOverflowItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index + 1}`,
    width,
  }));
}

describe("partitionSessionTabsForOverflow", () => {
  it("keeps all sessions visible when they fit", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(3),
      activeId: "session-2",
      availableWidth: 320,
      gapWidth: 10,
    })).toEqual({
      visibleIds: ["session-1", "session-2", "session-3"],
      overflowIds: [],
      hasOverflow: false,
    });
  });

  it("moves trailing sessions into overflow when width is constrained", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(5),
      activeId: "session-1",
      availableWidth: 330,
      overflowControlWidth: 30,
    })).toEqual({
      visibleIds: ["session-1", "session-2", "session-3"],
      overflowIds: ["session-4", "session-5"],
      hasOverflow: true,
    });
  });

  it("forces an active session near the end to stay visible", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(5),
      activeId: "session-5",
      availableWidth: 330,
      overflowControlWidth: 30,
    })).toEqual({
      visibleIds: ["session-1", "session-2", "session-5"],
      overflowIds: ["session-3", "session-4"],
      hasOverflow: true,
    });
  });

  it("promotes an overflow-selected session without evicting the previous active tab", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(5),
      activeId: "session-5",
      promotedIds: ["session-3", "session-5"],
      availableWidth: 330,
      overflowControlWidth: 30,
    })).toEqual({
      visibleIds: ["session-1", "session-3", "session-5"],
      overflowIds: ["session-2", "session-4"],
      hasOverflow: true,
    });
  });

  it("keeps the active session visible when promoted sessions exceed capacity", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(3, 120),
      activeId: "session-3",
      promotedIds: ["session-1", "session-2", "session-3"],
      availableWidth: 160,
      overflowControlWidth: 30,
    })).toEqual({
      visibleIds: ["session-3"],
      overflowIds: ["session-1", "session-2"],
      hasOverflow: true,
    });
  });

  it("keeps one context session visible with the active session when requested", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(4, 120),
      activeId: "session-4",
      availableWidth: 180,
      overflowControlWidth: 30,
      minimumVisibleCount: 2,
    })).toEqual({
      visibleIds: ["session-1", "session-4"],
      overflowIds: ["session-2", "session-3"],
      hasOverflow: true,
    });
  });

  it("keeps zero or one session out of overflow", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: [],
      activeId: null,
      availableWidth: 0,
    })).toEqual({
      visibleIds: [],
      overflowIds: [],
      hasOverflow: false,
    });

    expect(partitionSessionTabsForOverflow({
      tabs: tabs(1),
      activeId: "session-1",
      availableWidth: 0,
      overflowControlWidth: 30,
    })).toEqual({
      visibleIds: ["session-1"],
      overflowIds: [],
      hasOverflow: false,
    });
  });

  it("accounts for reserved fixed and file-tab width", () => {
    expect(partitionSessionTabsForOverflow({
      tabs: tabs(4),
      activeId: "session-1",
      availableWidth: 500,
      reservedWidth: 170,
      overflowControlWidth: 30,
    })).toEqual({
      visibleIds: ["session-1", "session-2", "session-3"],
      overflowIds: ["session-4"],
      hasOverflow: true,
    });
  });

  it("only reserves file-tab width after protected chat tabs have room", () => {
    expect(resolveSessionTabReservedWidth({
      availableWidth: 360,
      fixedControlWidth: 32,
      fileTabsWidth: 120,
      fileTabsMaxReserveRatio: 0.45,
      protectedSessionWidth: 260,
      gapWidth: 4,
    })).toBe(104);
  });

  it("drops file-tab reserve before forcing protected chat tabs out", () => {
    expect(resolveSessionTabReservedWidth({
      availableWidth: 280,
      fixedControlWidth: 32,
      fileTabsWidth: 120,
      fileTabsMaxReserveRatio: 0.45,
      protectedSessionWidth: 260,
      gapWidth: 4,
    })).toBe(32);
  });
});
