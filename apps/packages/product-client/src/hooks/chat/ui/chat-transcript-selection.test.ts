import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachChatTranscriptSelectionListeners,
  createChatTranscriptSelectionHandlers,
} from "#product/hooks/chat/ui/chat-transcript-selection-handlers";
import {
  EMPTY_TRANSCRIPT_TARGET_FACTS,
  type TranscriptSelectionClampEdge,
  type TranscriptTargetFacts,
} from "#product/domain/chats/transcript/transcript-selection";

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

// Primary-modifier detection (isPrimarySelectAllEvent) is platform-derived, and
// the keydown fixtures use Cmd (metaKey). In Node the test navigator reflects the
// host OS, so pin macOS for deterministic select-all handling on dev machines and
// Linux CI.
beforeEach(() => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      pointerup: vi.fn(),
      keydown: vi.fn(),
      selectall: vi.fn(),
      copy: vi.fn(),
      selectionchange: vi.fn(),
      scroll: vi.fn(),
    });

    expect(windowTarget.addCalls).toEqual([
      { type: "pointerdown", options: { capture: true } },
      { type: "pointerup", options: { capture: true } },
      { type: "pointercancel", options: { capture: true } },
      { type: "keydown", options: { capture: true } },
      { type: "proliferate:select-all", options: undefined },
      { type: "copy", options: { capture: true } },
      { type: "scroll", options: { capture: true } },
    ]);
    expect(documentTarget.addCalls).toEqual([
      { type: "selectionchange", options: undefined },
    ]);

    detach();

    expect(windowTarget.removeCalls).toEqual([
      { type: "pointerdown", options: { capture: true } },
      { type: "pointerup", options: { capture: true } },
      { type: "pointercancel", options: { capture: true } },
      { type: "keydown", options: { capture: true } },
      { type: "proliferate:select-all", options: undefined },
      { type: "copy", options: { capture: true } },
      { type: "scroll", options: { capture: true } },
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
      pointerSelectingRef: { current: false },
      getActiveElement: () => transcriptTarget,
      getSelection: () => selection,
      getTargetFactsForEvent: (target) =>
        target === transcriptTarget ? facts({ insideRoot: true }) : facts(),
      isSelectAllCommandOwner: () => false,
      focusRoot: (targetRoot) => targetRoot.focus(),
      setFullSelectionMarker: () => {
        markerSet = true;
      },
      isFullSelectionMarker: () => markerSet,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => false,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
      getSelectedResponse: () => null,
      isSelectedResponseVisible: () => true,
      setSelectedResponse: vi.fn(),
      hasSelectedResponse: () => false,
      requestSelectedResponseMenuFocus: vi.fn(),
      dismissSelectedResponse: vi.fn(),
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
      pointerSelectingRef: { current: false },
      getActiveElement: () => textEntryTarget,
      getSelection: () => ({ rangeCount: 1 } as Selection),
      getTargetFactsForEvent: (target) => {
        if (target === transcriptTarget) return facts({ insideRoot: true });
        if (target === textEntryTarget) return facts({ insideRoot: true, textEntry: true });
        return facts();
      },
      isSelectAllCommandOwner: () => false,
      focusRoot: (targetRoot) => targetRoot.focus(),
      setFullSelectionMarker: () => {
        markerSet = true;
      },
      isFullSelectionMarker: () => markerSet,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => false,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
      getSelectedResponse: () => null,
      isSelectedResponseVisible: () => true,
      setSelectedResponse: vi.fn(),
      hasSelectedResponse: () => false,
      requestSelectedResponseMenuFocus: vi.fn(),
      dismissSelectedResponse: vi.fn(),
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
      pointerSelectingRef: { current: false },
      getActiveElement: () => transcriptTarget,
      getSelection: () => selection,
      getTargetFactsForEvent: (target) =>
        target === transcriptTarget ? facts({ insideRoot: true }) : facts(),
      isSelectAllCommandOwner: () => false,
      focusRoot: vi.fn(),
      setFullSelectionMarker: vi.fn(),
      isFullSelectionMarker: () => false,
      isExactRootSelection: () => false,
      nodeInsideRoot: (node) => node === anchor,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot,
      getSelectedResponse: () => null,
      isSelectedResponseVisible: () => true,
      setSelectedResponse: vi.fn(),
      hasSelectedResponse: () => false,
      requestSelectedResponseMenuFocus: vi.fn(),
      dismissSelectedResponse: vi.fn(),
    });

    handlers.selectionchange();
    expect(clampSelectionToRoot).not.toHaveBeenCalled();

    handlers.pointerdown({ target: transcriptTarget } as PointerEvent);
    handlers.selectionchange();
    expect(clampSelectionToRoot).toHaveBeenCalledWith(selection, root, "end");
  });

  it("publishes an assistant selection after pointer selection and dismisses it on scroll", () => {
    const root = {} as HTMLElement;
    const transcriptTarget = {} as EventTarget;
    const linkTarget = {} as EventTarget;
    const selection = { rangeCount: 1 } as Selection;
    const selectedResponse = {
      text: "selected response",
      anchorRect: {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        top: 2,
        right: 4,
        bottom: 6,
        left: 1,
      },
    };
    const setSelectedResponse = vi.fn();
    let hasSelectedResponse = false;
    let isSelectedResponseVisible = true;
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: { current: false },
      allTranscriptSelectedRef: { current: false },
      pointerSelectingRef: { current: false },
      getActiveElement: () => transcriptTarget,
      getSelection: () => selection,
      getTargetFactsForEvent: (target) => {
        if (target === transcriptTarget) return facts({ insideRoot: true });
        if (target === linkTarget) {
          return facts({
            insideRoot: true,
            nativeInteractive: true,
            selectableInteractiveText: true,
          });
        }
        return facts();
      },
      isSelectAllCommandOwner: () => false,
      focusRoot: vi.fn(),
      setFullSelectionMarker: vi.fn(),
      isFullSelectionMarker: () => false,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => true,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
      getSelectedResponse: () => selectedResponse,
      isSelectedResponseVisible: () => isSelectedResponseVisible,
      setSelectedResponse: (value) => {
        hasSelectedResponse = value !== null;
        setSelectedResponse(value);
      },
      hasSelectedResponse: () => hasSelectedResponse,
      requestSelectedResponseMenuFocus: vi.fn(),
      dismissSelectedResponse: vi.fn(),
    });

    handlers.pointerdown({ target: transcriptTarget } as PointerEvent);
    handlers.selectionchange();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(null);

    handlers.pointerup();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(selectedResponse);

    handlers.pointerdown({ target: {} as EventTarget } as PointerEvent);
    expect(setSelectedResponse).toHaveBeenLastCalledWith(null);

    handlers.pointerdown({ target: linkTarget } as PointerEvent);
    handlers.selectionchange();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(null);

    handlers.pointerup();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(selectedResponse);

    handlers.scroll();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(selectedResponse);

    isSelectedResponseVisible = false;
    handlers.scroll();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(null);
  });

  it("moves keyboard focus into an open menu and restores transcript focus on Escape", () => {
    const root = {} as HTMLElement;
    const requestSelectedResponseMenuFocus = vi.fn();
    const dismissSelectedResponse = vi.fn();
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: { current: true },
      allTranscriptSelectedRef: { current: false },
      pointerSelectingRef: { current: false },
      getActiveElement: () => root,
      getSelection: () => ({ rangeCount: 1 } as Selection),
      getTargetFactsForEvent: () => facts({ insideRoot: true }),
      isSelectAllCommandOwner: () => false,
      focusRoot: vi.fn(),
      setFullSelectionMarker: vi.fn(),
      isFullSelectionMarker: () => false,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => true,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
      getSelectedResponse: () => null,
      isSelectedResponseVisible: () => true,
      setSelectedResponse: vi.fn(),
      hasSelectedResponse: () => true,
      requestSelectedResponseMenuFocus,
      dismissSelectedResponse,
    });

    const focusMenu = keydownEvent(root, {
      key: "F10",
      metaKey: false,
      shiftKey: true,
    });
    handlers.keydown(focusMenu);
    expect(focusMenu.preventDefault).toHaveBeenCalled();
    expect(requestSelectedResponseMenuFocus).toHaveBeenCalledOnce();

    const escape = keydownEvent(root, {
      key: "Escape",
      metaKey: false,
    });
    handlers.keydown(escape);
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(dismissSelectedResponse).toHaveBeenCalledWith(true);
  });

  it("publishes keyboard selections and clears the menu with the native selection", () => {
    const root = {} as HTMLElement;
    const anchor = {} as Node;
    let selection: Selection | null = {
      rangeCount: 1,
      anchorNode: anchor,
      focusNode: anchor,
    } as Selection;
    const selectedResponse = {
      text: "keyboard selection",
      anchorRect: {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        top: 2,
        right: 4,
        bottom: 6,
        left: 1,
      },
    };
    const setSelectedResponse = vi.fn();
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: { current: false },
      allTranscriptSelectedRef: { current: false },
      pointerSelectingRef: { current: false },
      getActiveElement: () => root,
      getSelection: () => selection,
      getTargetFactsForEvent: () => facts({ insideRoot: true }),
      isSelectAllCommandOwner: () => false,
      focusRoot: vi.fn(),
      setFullSelectionMarker: vi.fn(),
      isFullSelectionMarker: () => false,
      isExactRootSelection: () => false,
      nodeInsideRoot: (node) => node === anchor,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
      getSelectedResponse: () => selectedResponse,
      isSelectedResponseVisible: () => true,
      setSelectedResponse,
      hasSelectedResponse: () => true,
      requestSelectedResponseMenuFocus: vi.fn(),
      dismissSelectedResponse: vi.fn(),
    });

    handlers.selectionchange();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(selectedResponse);

    selection = null;
    handlers.selectionchange();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(null);
  });

  it("keeps the published selection while the menu owns focus and the range is lost", () => {
    const root = {} as HTMLElement;
    const menuTarget = {} as EventTarget;
    let activeElement: EventTarget = menuTarget;
    const setSelectedResponse = vi.fn();
    const handlers = createChatTranscriptSelectionHandlers({
      rootRef: { current: root },
      getCopyText: () => "semantic transcript",
      transcriptOwnedRef: { current: false },
      allTranscriptSelectedRef: { current: false },
      pointerSelectingRef: { current: false },
      getActiveElement: () => activeElement,
      getSelection: () => null,
      getTargetFactsForEvent: (target) =>
        target === menuTarget
          ? facts({ contextualActions: true })
          : facts({ insideRoot: true }),
      isSelectAllCommandOwner: () => false,
      focusRoot: vi.fn(),
      setFullSelectionMarker: vi.fn(),
      isFullSelectionMarker: () => false,
      isExactRootSelection: () => false,
      nodeInsideRoot: () => true,
      getSelectionDirection: () => "forward",
      clampSelectionToRoot: vi.fn(),
      getSelectedResponse: () => null,
      isSelectedResponseVisible: () => true,
      setSelectedResponse,
      hasSelectedResponse: () => true,
      requestSelectedResponseMenuFocus: vi.fn(),
      dismissSelectedResponse: vi.fn(),
    });

    // WebKit clears the native selection when keyboard invocation focuses the
    // first menu item; that loss must not dismiss the open menu.
    handlers.selectionchange();
    expect(setSelectedResponse).not.toHaveBeenCalled();

    // Once focus is back in the document the same empty selection dismisses.
    activeElement = root;
    handlers.selectionchange();
    expect(setSelectedResponse).toHaveBeenLastCalledWith(null);
  });
});
