/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";

afterEach(() => {
  cleanup();
});

describe("GitReviewTargetSelector", () => {
  it("focuses branch search when the picker opens", async () => {
    render(
      <GitReviewTargetSelector
        mode="branch"
        baseRef="origin/main"
        branchRefs={[{
          name: "origin/main",
          isDefault: true,
          isHead: false,
          isRemote: true,
          upstream: null,
        }]}
        isRuntimeReady
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /origin\/main/i }));
    const search = screen.getByPlaceholderText("Search branches");

    await waitFor(() => expect(document.activeElement).toBe(search));
  });
});
