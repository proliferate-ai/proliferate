// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(cleanup);

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
});
