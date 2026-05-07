import { describe, expect, it, vi } from "vitest";
import {
  attachChatTranscriptSelectionListeners,
  createChatTranscriptSelectionHandlers,
} from "@/hooks/chat/use-chat-transcript-selection";
import {
  EMPTY_TRANSCRIPT_TARGET_FACTS,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "@/lib/domain/chat/transcript/transcript-selection";

interface ListenerRecord {
  type: string;
  options?: AddEventListenerOptions | boolean;
}

function fakeTarget() {
  const addCalls: ListenerRecord[] = [];
  const removeCalls: ListenerRecord[] = [];
  return {
    addCalls,
    removeCalls,
    target: {
      addEventListener: vi.fn((type: string, _handler: EventListener, options?: AddEventListenerOptions | boolean) => {
        addCalls.push({ type, options });
      }),
      removeEventListener: vi.fn((type: string, _handler: EventListener, options?: AddEventListenerOptions | boolean) => {
        removeCalls.push({ type, options });
      }),
    },
  };
}

function facts(overrides: Partial<TranscriptTargetFacts> = {}): TranscriptTargetFacts {
  return {
    ...EMPTY_TRANSCRIPT_TARGET_FACTS,
    ...overrides,
  };
}

function keydownEvent(target: EventTarget, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "a",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("attachChatTranscriptSelectionListeners", () => {
  it("attaches window capture listeners and document selectionchange", () => {
    const windowTarget = fakeTarget();
    const documentTarget = fakeTarget();
    const detach = attachChatTranscriptSelectionListeners({
      windowTarget: windowTarget.target,
      documentTarget: documentTarget.target,
    }, {
      pointerdown: vi.fn(),
      keydown: vi.fn(),
      copy: vi.fn(),
      selectionchange: vi.fn(),
    });

    expect(windowTarget.addCalls).toEqual([
      { type: "pointerdown", options: { capture: true } },
      { type: "keydown", options: { capture: true } },
      { type: "copy", options: { capture: true } },
    ]);
    expect(documentTarget.addCalls).toEqual([
      { type: "selectionchange", options: undefined },
    ]);

    detach();

    expect(windowTarget.removeCalls).toEqual([
      { type: "pointerdown", options: { capture: true } },
      { type: "keydown", options: { capture: true } },
      { type: "copy", options: { capture: true } },
    ]);
    expect(documentTarget.removeCalls).toEqual([
      { type: "selectionchange", options: undefined },
    ]);
  });
});

describe("createChatTranscriptSelectionHandlers", () => {
  it("copies the lazy semantic transcript payload after transcript-owned primary-A", () => {
    const root = { focus: vi.fn() } as unknown as HTMLElement;
    const transcriptTarget = {} as EventTarget;
    const selection = { rangeCount: 1 } as Selection;
    let markerSet = false;
    const clipboardData = { setData: vi.fn() };
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: { current: false },
      allTranscriptSelectedRef: { current: false },
      getActiveElement: () => transcriptTarget,
      getSelection: () => selection,
      getTargetFactsForEvent: (target) =>
        target === transcriptTarget ? facts({ insideRoot: true }) : facts(),
      focusRoot: (targetRoot) => targetRoot.focus(),
      setFullSelectionMarker: () => {
        markerSet = true;
      },
      isFullSelectionMarker: () => markerSet,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => false,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
    });

    handlers.pointerdown({ target: transcriptTarget } as PointerEvent);
    const keyEvent = keydownEvent(transcriptTarget);
    handlers.keydown(keyEvent);
    const copyEvent = {
      target: transcriptTarget,
      clipboardData,
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    handlers.copy(copyEvent);

    expect(root.focus).toHaveBeenCalled();
    expect(keyEvent.preventDefault).toHaveBeenCalled();
    expect(markerSet).toBe(true);
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "semantic transcript");
    expect(copyEvent.preventDefault).toHaveBeenCalled();
  });

  it("clears stale transcript ownership for live text-entry targets", () => {
    const root = { focus: vi.fn() } as unknown as HTMLElement;
    const transcriptTarget = {} as EventTarget;
    const textEntryTarget = {} as EventTarget;
    let markerSet = false;
    const owned = { current: false };
    const fullSelection = { current: false };
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: owned,
      allTranscriptSelectedRef: fullSelection,
      getActiveElement: () => textEntryTarget,
      getSelection: () => ({ rangeCount: 1 } as Selection),
      getTargetFactsForEvent: (target) => {
        if (target === transcriptTarget) return facts({ insideRoot: true });
        if (target === textEntryTarget) return facts({ insideRoot: true, textEntry: true });
        return facts();
      },
      focusRoot: (targetRoot) => targetRoot.focus(),
      setFullSelectionMarker: () => {
        markerSet = true;
      },
      isFullSelectionMarker: () => markerSet,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => false,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
    });

    handlers.pointerdown({ target: transcriptTarget } as PointerEvent);
    fullSelection.current = true;
    const keyEvent = keydownEvent(transcriptTarget);
    handlers.keydown(keyEvent);

    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    expect(markerSet).toBe(false);
    expect(owned.current).toBe(false);
    expect(fullSelection.current).toBe(false);
  });

  it("clamps cross-root native selections only while transcript-owned", () => {
    const root = {} as HTMLElement;
    const transcriptTarget = {} as EventTarget;
    const anchor = {} as Node;
    const focus = {} as Node;
    const selection = {
      rangeCount: 1,
      anchorNode: anchor,
      focusNode: focus,
    } as Selection;
    const clampSelectionToRoot = vi.fn((
      _selection: Selection,
      _root: HTMLElement,
      _edge: TranscriptSelectionClampEdge,
    ) => {});
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: { current: false },
      allTranscriptSelectedRef: { current: false },
      getActiveElement: () => transcriptTarget,
      getSelection: () => selection,
      getTargetFactsForEvent: (target) =>
        target === transcriptTarget ? facts({ insideRoot: true }) : facts(),
      focusRoot: vi.fn(),
      setFullSelectionMarker: vi.fn(),
      isFullSelectionMarker: () => false,
      isExactRootSelection: () => false,
      nodeInsideRoot: (node) => node === anchor,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot,
    });

    handlers.selectionchange();
    expect(clampSelectionToRoot).not.toHaveBeenCalled();

    handlers.pointerdown({ target: transcriptTarget } as PointerEvent);
    handlers.selectionchange();
    expect(clampSelectionToRoot).toHaveBeenCalledWith(selection, root, "end");
  });
});
