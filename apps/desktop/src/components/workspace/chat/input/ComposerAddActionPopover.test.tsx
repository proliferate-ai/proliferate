/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";

afterEach(() => {
  cleanup();
});

describe("ComposerAddActionPopover", () => {
  it("renders only file action", () => {
    render(
      <ComposerAddActionPopover
        canAttachFile
        attachFileDetail="Attach workspace files"
        onAttachFile={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));

    expect(screen.getByText("Add file")).toBeTruthy();
    expect(screen.queryByText("Add plan")).toBeNull();
    expect(screen.queryByText("Set a goal")).toBeNull();
    expect(screen.queryByText("Code review agents")).toBeNull();
    expect(screen.queryByTitle("Configure code review agents")).toBeNull();
  });
});
