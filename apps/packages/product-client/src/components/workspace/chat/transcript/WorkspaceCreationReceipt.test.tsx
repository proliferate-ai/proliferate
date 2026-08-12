// @vitest-environment jsdom

import { useState, type CSSProperties } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCreationReceiptView } from "#product/components/workspace/chat/transcript/WorkspaceCreationReceipt";
import type { WorkspaceCreationReceiptPresentation } from "#product/lib/domain/workspaces/creation/creation-receipt";

function presentation(
  overrides: Partial<WorkspaceCreationReceiptPresentation>,
): WorkspaceCreationReceiptPresentation {
  return {
    line: "Creating worktree",
    busyLabel: null,
    showSpinner: false,
    logLines: [],
    defaultExpanded: false,
    showRerun: false,
    rerunDisabled: false,
    rerunLabel: "Rerun setup",
    showCreationRetry: false,
    ...overrides,
  };
}

function renderReceipt(overrides: Partial<WorkspaceCreationReceiptPresentation>) {
  return render(
    <WorkspaceCreationReceiptView
      presentation={presentation(overrides)}
      expanded={false}
      onToggleExpanded={() => {}}
    />,
  );
}

let originalScrollIntoView: PropertyDescriptor | undefined;
const scrollIntoView = vi.fn();

beforeEach(() => {
  originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockReset();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

describe("WorkspaceCreationReceiptView", () => {
  // The busy phases change the label text ("Creating worktree" →
  // "Worktree created · Setup running"), so an indicator placed after the
  // text jumps to a new x on every phase change. It must sit in the fixed
  // leading icon slot instead.
  it("renders the spinner in the leading icon slot, before the label", () => {
    const { container } = renderReceipt({
      line: "Worktree created",
      busyLabel: "Setup running",
      showSpinner: true,
    });

    const button = container.querySelector("button");
    const spinners = container.querySelectorAll("[data-loading-spinner]");
    expect(spinners).toHaveLength(1);
    const spinner = spinners[0];
    const label = [...button!.querySelectorAll("span")]
      .find((span) => span.textContent === "Worktree created");
    expect(label).toBeDefined();
    expect(
      spinner.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the fork glyph and no spinner once work settles", () => {
    const { container } = renderReceipt({
      line: "Worktree created",
      showSpinner: false,
    });

    expect(container.querySelector("[data-loading-spinner]")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("reveals an expanded pre-transcript receipt above the measured composer safe area", () => {
    function Harness() {
      const [expanded, setExpanded] = useState(false);
      return (
        <div style={{ "--chat-composer-safe-area": "156px" } as CSSProperties}>
          <WorkspaceCreationReceiptView
            presentation={presentation({
              line: "Worktree created",
              logLines: [{ tone: "default", text: "Created at /workspace/feature" }],
              showRerun: true,
            })}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((current) => !current)}
            onRerun={() => {}}
          />
        </div>
      );
    }

    const { container, getByRole } = render(<Harness />);
    const receipt = container.querySelector<HTMLElement>("[data-workspace-creation-receipt]");

    expect(receipt?.style.scrollMarginBlockEnd).toBe(
      "var(--chat-composer-safe-area, 40px)",
    );
    fireEvent.click(getByRole("button", { name: /Worktree created/ }));

    expect(getByRole("button", { name: "Rerun setup" })).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("does not move the transcript when a historical receipt mounts expanded", () => {
    render(
      <WorkspaceCreationReceiptView
        presentation={presentation({
          line: "Worktree created",
          logLines: [{ tone: "destructive", text: "Setup failed" }],
        })}
        expanded
        onToggleExpanded={() => {}}
      />,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
