// @vitest-environment jsdom

import { useRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { useComposerTextareaAutosize } from "./use-composer-textarea-autosize";

let textareaLineHeightPx = 16;
let textareaScrollHeightPx = 400;
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
);

function AutosizeHarness() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useComposerTextareaAutosize({
    textareaRef,
    value: "long draft",
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  return <textarea aria-label="Composer" ref={textareaRef} />;
}

describe("useComposerTextareaAutosize", () => {
  beforeEach(() => {
    textareaLineHeightPx = 16;
    textareaScrollHeightPx = 400;
    vi.stubGlobal("getComputedStyle", (element: Element) => ({
      fontSize: element === document.documentElement ? "16px" : "12px",
      lineHeight: element.tagName === "TEXTAREA" ? `${textareaLineHeightPx}px` : "16px",
    } as CSSStyleDeclaration));
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => textareaScrollHeightPx,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("style");
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        originalScrollHeightDescriptor,
      );
    } else {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("recomputes cached sizing when appearance text scale changes", async () => {
    render(<AutosizeHarness />);

    const textarea = screen.getByLabelText("Composer") as HTMLTextAreaElement;
    expect(textarea.style.height).toBe("256px");

    textareaLineHeightPx = 17;
    document.documentElement.style.setProperty("--text-chat", "13px");

    await waitFor(() => {
      expect(textarea.style.height).toBe("272px");
    });
  });
});
