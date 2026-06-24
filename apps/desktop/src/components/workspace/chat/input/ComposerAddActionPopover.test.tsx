/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";

afterEach(() => {
  cleanup();
});

describe("ComposerAddActionPopover", () => {
  it("renders file and plan actions without review controls", () => {
    render(
      <ComposerAddActionPopover
        canAttachFile
        attachFileDetail="Attach workspace files"
        canAttachPlan
        attachPlanDetail="Select an accepted plan"
        workspaceUiKey="workspace-1"
        sdkWorkspaceId="sdk-workspace-1"
        onAttachFile={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add file or plan" }));

    expect(screen.getByText("Add file")).toBeTruthy();
    expect(screen.getByText("Add plan")).toBeTruthy();
    expect(screen.queryByText("Code review agents")).toBeNull();
    expect(screen.queryByTitle("Configure code review agents")).toBeNull();
  });
});
