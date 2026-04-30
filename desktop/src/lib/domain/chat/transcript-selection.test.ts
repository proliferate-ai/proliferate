import { describe, expect, it } from "vitest";
import {
  EMPTY_TRANSCRIPT_TARGET_FACTS,
  isPrimarySelectAllEvent,
  resolveCopyAction,
  resolvePointerOwnership,
  resolvePrimaryAAction,
  resolveSelectionChangeAction,
  type TranscriptTargetFacts,
} from "@/lib/domain/chat/transcript-selection";

function target(overrides: Partial<TranscriptTargetFacts> = {}): TranscriptTargetFacts {
  return {
    ...EMPTY_TRANSCRIPT_TARGET_FACTS,
    ...overrides,
  };
}

describe("transcript selection decisions", () => {
  it("matches primary-A by platform modifier", () => {
    expect(isPrimarySelectAllEvent({
      key: "a",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    }, true)).toBe(true);
    expect(isPrimarySelectAllEvent({
      key: "A",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    }, false)).toBe(true);
    expect(isPrimarySelectAllEvent({
      key: "a",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    }, true)).toBe(false);
  });

  it("sets ownership only from unblocked transcript targets", () => {
    expect(resolvePointerOwnership(target({ insideRoot: true }))).toBe("set-owned");
    expect(resolvePointerOwnership(target({ insideRoot: false }))).toBe("clear-owned");
    expect(resolvePointerOwnership(target({ insideRoot: true, textEntry: true }))).toBe("clear-owned");
    expect(resolvePointerOwnership(target({ insideRoot: true, terminalZone: true }))).toBe("clear-owned");
    expect(resolvePointerOwnership(target({ insideRoot: true, nativeInteractive: true }))).toBe("clear-owned");
    expect(resolvePointerOwnership(target({ insideRoot: true, ariaInteractive: true }))).toBe("clear-owned");
  });

  it("treats ignored controls as chrome without blocking body descendants", () => {
    expect(resolvePointerOwnership(target({
      insideRoot: true,
      ignoredChrome: true,
    }))).toBe("clear-owned");
    expect(resolvePointerOwnership(target({
      insideRoot: true,
      ignoredChrome: false,
    }))).toBe("set-owned");
  });

  it("runs primary-A only for owned and live-valid transcript targets", () => {
    const inside = target({ insideRoot: true });

    expect(resolvePrimaryAAction({
      owned: true,
      isSelectAll: true,
      defaultPrevented: false,
      eventTarget: inside,
      activeTarget: target(),
    })).toBe("select-root");
    expect(resolvePrimaryAAction({
      owned: false,
      isSelectAll: true,
      defaultPrevented: false,
      eventTarget: inside,
      activeTarget: target(),
    })).toBe("ignore");
    expect(resolvePrimaryAAction({
      owned: true,
      isSelectAll: true,
      defaultPrevented: false,
      eventTarget: inside,
      activeTarget: target({ insideRoot: false, textEntry: true }),
    })).toBe("clear-owned");
    expect(resolvePrimaryAAction({
      owned: true,
      isSelectAll: true,
      defaultPrevented: true,
      eventTarget: inside,
      activeTarget: target(),
    })).toBe("ignore");
  });

  it("clamps document selection changes only when transcript ownership is active", () => {
    expect(resolveSelectionChangeAction({
      owned: false,
      anchorInsideRoot: true,
      focusInsideRoot: false,
      exactRootSelection: false,
      direction: "forward",
    })).toEqual({
      clampEdge: null,
      clearFullSelection: true,
    });

    expect(resolveSelectionChangeAction({
      owned: true,
      anchorInsideRoot: true,
      focusInsideRoot: false,
      exactRootSelection: false,
      direction: "forward",
    })).toEqual({
      clampEdge: "end",
      clearFullSelection: true,
    });

    expect(resolveSelectionChangeAction({
      owned: true,
      anchorInsideRoot: false,
      focusInsideRoot: true,
      exactRootSelection: false,
      direction: "forward",
    })).toEqual({
      clampEdge: "start",
      clearFullSelection: true,
    });

    expect(resolveSelectionChangeAction({
      owned: true,
      anchorInsideRoot: false,
      focusInsideRoot: true,
      exactRootSelection: false,
      direction: "backward",
    }).clampEdge).toBe("end");
  });

  it("keeps exact full-root selection state and clears stale state otherwise", () => {
    expect(resolveSelectionChangeAction({
      owned: true,
      anchorInsideRoot: true,
      focusInsideRoot: true,
      exactRootSelection: true,
      direction: "forward",
    })).toEqual({
      clampEdge: null,
      clearFullSelection: false,
    });
    expect(resolveSelectionChangeAction({
      owned: true,
      anchorInsideRoot: true,
      focusInsideRoot: true,
      exactRootSelection: false,
      direction: "forward",
    }).clearFullSelection).toBe(true);
  });

  it("overrides copy only for active logical full-selection and valid live targets", () => {
    const inside = target({ insideRoot: true });
    expect(resolveCopyAction({
      fullRootSelected: true,
      eventTarget: inside,
      activeTarget: target(),
    })).toBe("copy-semantic");
    expect(resolveCopyAction({
      fullRootSelected: false,
      eventTarget: inside,
      activeTarget: target(),
    })).toBe("ignore");
    expect(resolveCopyAction({
      fullRootSelected: true,
      eventTarget: inside,
      activeTarget: target({ insideRoot: false, terminalZone: true }),
    })).toBe("clear-owned");
  });
});
