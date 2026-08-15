// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceCreationReceiptView } from "#product/components/workspace/chat/transcript/WorkspaceCreationReceipt";
import type { WorkspaceCreationReceiptPresentation } from "#product/lib/domain/workspaces/creation/creation-receipt";

function presentation(
  overrides: Partial<WorkspaceCreationReceiptPresentation>,
): WorkspaceCreationReceiptPresentation {
  return {
    noun: "worktree",
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

  it("shows the fork glyph and no spinner once a worktree receipt settles", () => {
    const { container } = renderReceipt({
      noun: "worktree",
      line: "Worktree created",
      showSpinner: false,
    });

    expect(container.querySelector("[data-loading-spinner]")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  // The fork mark is a worktree-only signal (PRO-251). A plain local
  // workspace receipt settles with no leading glyph rather than borrowing it.
  it("settles a workspace receipt with no leading glyph", () => {
    const { container } = renderReceipt({
      noun: "workspace",
      line: "Workspace created",
      showSpinner: false,
    });

    expect(container.querySelector("[data-loading-spinner]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the spinner while a workspace creation is in flight", () => {
    const { container } = renderReceipt({
      noun: "workspace",
      line: "Creating workspace",
      showSpinner: true,
    });

    expect(container.querySelectorAll("[data-loading-spinner]")).toHaveLength(1);
  });
});
