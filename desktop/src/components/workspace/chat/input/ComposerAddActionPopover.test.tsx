/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";

afterEach(() => {
  cleanup();
});

describe("ComposerAddActionPopover", () => {
  it("keeps the add popover open when configuring code review agents", () => {
    const onConfigureReview = vi.fn();

    render(
      <ComposerAddActionPopover
        canAttachFile
        attachFileDetail="Attach workspace files"
        canAttachPlan
        attachPlanDetail="Select an accepted plan"
        canStartReview
        reviewDetail="Start or configure review agents"
        workspaceUiKey="workspace-1"
        sdkWorkspaceId="sdk-workspace-1"
        onAttachFile={() => {}}
        onStartReview={() => {}}
        onConfigureReview={onConfigureReview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add file, plan, or review agents" }));
    fireEvent.click(screen.getByTitle("Configure code review agents"));

    expect(onConfigureReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Add file")).toBeTruthy();
    expect(screen.getByText("Add plan")).toBeTruthy();
    expect(screen.getByText("Code review agents")).toBeTruthy();
  });
});
