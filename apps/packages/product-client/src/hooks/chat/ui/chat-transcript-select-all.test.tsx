// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatTranscriptSelection } from "#product/hooks/chat/ui/chat-transcript-selection";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";
import {
  runSelectAllCommand,
} from "#product/lib/infra/dom/dom-select-all";

beforeEach(() => {
  clearShortcutHandlerRegistryForTests();
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    userAgent: "Mac OS X",
  });
});

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  cleanup();
  clearShortcutHandlerRegistryForTests();
  vi.unstubAllGlobals();
});

describe("chat transcript select all", () => {
  it("selects the visible transcript from the native menu with no prior focus or selection", () => {
    const { getByTestId } = render(<TranscriptSelectionHarness />);
    const root = getByTestId("transcript-root");

    expect(document.activeElement).toBe(document.body);
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(runShortcutHandler("app.select-all", { source: "menu" })).toBe(true);

    expect(document.activeElement).toBe(root);
    expectExactVisibleTranscriptSelection(root);
  });

  it("selects the transcript when the empty chat surface owns focus", () => {
    const { getByTestId } = render(<TranscriptSelectionHarness />);
    const chatRoot = getByTestId("chat-root");
    const transcriptRoot = getByTestId("transcript-root");
    chatRoot.focus();

    expect(runSelectAllCommand()).toBe(true);

    expect(document.activeElement).toBe(transcriptRoot);
    expectExactVisibleTranscriptSelection(transcriptRoot);
  });

  it("creates the same full selection from a real primary-A keydown", () => {
    const { getByTestId } = render(<TranscriptSelectionHarness />);
    const chatRoot = getByTestId("chat-root");
    const transcriptRoot = getByTestId("transcript-root");
    chatRoot.focus();
    const event = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    chatRoot.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(transcriptRoot);
    expectExactVisibleTranscriptSelection(transcriptRoot);
    expectSemanticTranscriptCopy();
  });

  it("copies the complete semantic transcript after an idle native-menu select all", () => {
    render(<TranscriptSelectionHarness />);
    expect(runShortcutHandler("app.select-all", { source: "menu" })).toBe(true);

    expectSemanticTranscriptCopy();
  });

  it("does not let a hidden kept-mounted chat claim the native menu command", () => {
    const { getByTestId } = render(
      <div hidden>
        <TranscriptSelectionHarness />
      </div>,
    );

    expect(runSelectAllCommand()).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(document.getSelection()?.toString()).not.toContain("Assistant response");
    expect(getByTestId("transcript-root").closest("[hidden]")).not.toBeNull();
  });

  it("requires an explicit owner when more than one chat transcript is rendered", () => {
    const { getByTestId } = render(<MultipleTranscriptHarness />);
    const firstChat = getByTestId("chat-root-first");
    const firstTranscript = getByTestId("transcript-root-first");

    expect(runSelectAllCommand()).toBe(false);
    expect(document.getSelection()?.rangeCount).toBe(0);

    firstChat.focus();
    expect(runSelectAllCommand()).toBe(true);

    expect(document.activeElement).toBe(firstTranscript);
    expectExactVisibleTranscriptSelection(firstTranscript);
    expect(document.getSelection()?.toString()).not.toContain("Second assistant response");
  });

  it("leaves select all with the focused composer text entry", () => {
    const { getByTestId } = render(<TranscriptSelectionHarness />);
    const input = getByTestId("composer-input") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(3, 3);

    expect(runShortcutHandler("app.select-all", { source: "menu" })).toBe(true);

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(document.getSelection()?.toString()).not.toContain("Assistant response");
  });

  it.each(["terminal", "browser"])(
    "does not take selection ownership from the focused %s surface",
    (zone) => {
      const { getByTestId } = render(<TranscriptSelectionHarness />);
      const foreignSurface = getByTestId(`${zone}-surface`);
      foreignSurface.focus();

      expect(runShortcutHandler("app.select-all", { source: "menu" })).toBe(false);
      expect(document.activeElement).toBe(foreignSurface);
      expect(document.getSelection()?.toString()).not.toContain("Assistant response");
    },
  );
});

function expectExactVisibleTranscriptSelection(root: HTMLElement) {
  const selection = document.getSelection();
  expect(selection).not.toBeNull();
  expect(selection?.isCollapsed).toBe(false);
  expect(selection?.toString()).toContain("User prompt");
  expect(selection?.toString()).toContain("Worked for 5s");
  expect(selection?.toString()).toContain("Assistant response");
  expect(selection?.rangeCount).toBe(1);

  const range = selection!.getRangeAt(0);
  expect(range.startContainer).toBe(root);
  expect(range.startOffset).toBe(0);
  expect(range.endContainer).toBe(root);
  expect(range.endOffset).toBe(root.childNodes.length);
}

function expectSemanticTranscriptCopy() {
  const clipboardData = { setData: vi.fn() };
  const copyEvent = new Event("copy", { cancelable: true });
  Object.defineProperty(copyEvent, "clipboardData", { value: clipboardData });
  window.dispatchEvent(copyEvent);

  expect(copyEvent.defaultPrevented).toBe(true);
  expect(clipboardData.setData).toHaveBeenCalledWith(
    "text/plain",
    "User prompt\n\nWorked for 5s\n\nAssistant response",
  );
}

function TranscriptSelectionHarness() {
  const rootRef = useRef<HTMLDivElement>(null);
  useChatTranscriptSelection({
    rootRef,
    getCopyText: () => "User prompt\n\nWorked for 5s\n\nAssistant response",
  });
  useShortcutHandler("app.select-all", () => runSelectAllCommand());

  return (
    <>
      <div data-testid="chat-root" data-focus-zone="chat" tabIndex={-1}>
        <div
          ref={rootRef}
          data-testid="transcript-root"
          data-chat-transcript-root="true"
          className="select-text"
          tabIndex={-1}
        >
          <article data-chat-user-message>User prompt</article>
          <div data-transcript-status>Worked for 5s</div>
          <article data-assistant-prose>Assistant response</article>
        </div>
        <input
          data-testid="composer-input"
          data-chat-composer-editor
          defaultValue="Draft prompt"
        />
      </div>
      <div data-testid="terminal-surface" data-focus-zone="terminal" tabIndex={0} />
      <div data-testid="browser-surface" data-focus-zone="browser" tabIndex={0} />
    </>
  );
}

function MultipleTranscriptHarness() {
  const firstRootRef = useRef<HTMLDivElement>(null);
  const secondRootRef = useRef<HTMLDivElement>(null);
  useChatTranscriptSelection({
    rootRef: firstRootRef,
    getCopyText: () => "User prompt\n\nWorked for 5s\n\nAssistant response",
  });
  useChatTranscriptSelection({
    rootRef: secondRootRef,
    getCopyText: () => "Second user prompt\n\nSecond assistant response",
  });

  return (
    <>
      <div data-testid="chat-root-first" data-focus-zone="chat" tabIndex={-1}>
        <div
          ref={firstRootRef}
          data-testid="transcript-root-first"
          data-chat-transcript-root="true"
          className="select-text"
          tabIndex={-1}
        >
          <article>User prompt</article>
          <div>Worked for 5s</div>
          <article>Assistant response</article>
        </div>
      </div>
      <div data-testid="chat-root-second" data-focus-zone="chat" tabIndex={-1}>
        <div
          ref={secondRootRef}
          data-testid="transcript-root-second"
          data-chat-transcript-root="true"
          className="select-text"
          tabIndex={-1}
        >
          <article>Second user prompt</article>
          <article>Second assistant response</article>
        </div>
      </div>
    </>
  );
}
