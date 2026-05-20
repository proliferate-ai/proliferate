// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { useChatRootFocus } from "@/hooks/chat/ui/use-chat-root-focus";

function ChatRootFocusHarness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const transcriptRootRef = useRef<HTMLDivElement>(null);
  const handlePointerDownCapture = useChatRootFocus(rootRef);

  return (
    <div>
      <button type="button" data-testid="before-chat">Before chat</button>
      <div
        ref={rootRef}
        data-testid="chat-root"
        data-focus-zone="chat"
        tabIndex={-1}
        onPointerDownCapture={handlePointerDownCapture}
      >
        <div data-testid="plain-chat-surface">Plain chat surface</div>
        <div
          ref={transcriptRootRef}
          data-testid="transcript-root"
          data-chat-transcript-root="true"
          tabIndex={-1}
        >
          <div data-testid="transcript-row">Transcript row</div>
        </div>
        <button type="button">Composer action</button>
      </div>
    </div>
  );
}

describe("useChatRootFocus", () => {
  afterEach(() => {
    cleanup();
  });

  it("focuses the chat root when a plain chat surface is clicked", () => {
    render(<ChatRootFocusHarness />);

    fireEvent.pointerDown(screen.getByTestId("plain-chat-surface"));

    expect(document.activeElement).toBe(screen.getByTestId("chat-root"));
  });

  it("preserves transcript-root focus for transcript clicks", () => {
    render(<ChatRootFocusHarness />);
    const transcriptRoot = screen.getByTestId("transcript-root");
    transcriptRoot.focus();

    fireEvent.pointerDown(screen.getByTestId("transcript-row"));

    expect(document.activeElement).toBe(transcriptRoot);
  });

  it("does not steal focus from interactive chat controls", () => {
    render(<ChatRootFocusHarness />);
    const existingFocus = screen.getByTestId("before-chat");
    existingFocus.focus();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Composer action" }));

    expect(document.activeElement).toBe(existingFocus);
  });
});
