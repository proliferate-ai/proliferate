// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnDocumentReferenceCard } from "#product/components/workspace/chat/transcript/TurnDocumentReferenceCard";

const fileActionMocks = vi.hoisted(() => ({
  canOpenPrimary: true,
  openPrimary: vi.fn(),
  inputs: [] as Array<{ rawPath: string }>,
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (input: { rawPath: string }) => {
    fileActionMocks.inputs.push(input);
    return fileActionMocks;
  },
}));

afterEach(() => {
  cleanup();
  fileActionMocks.canOpenPrimary = true;
  fileActionMocks.openPrimary.mockReset();
  fileActionMocks.inputs.length = 0;
});

describe("TurnDocumentReferenceCard", () => {
  it("renders a document result and opens its preview", () => {
    render(
      <TurnDocumentReferenceCard
        resource={{
          rawPath: "/repo/specs/decision.md:42",
          path: "/repo/specs/decision.md",
          displayName: "decision.md",
          typeLabel: "Document · MD",
        }}
      />,
    );

    const card = document.querySelector("[data-turn-document-reference]");
    expect(card?.className).toContain("rounded-lg");
    expect(card?.className).toContain("bg-diff-panel-surface");
    expect(document.querySelector("[data-icon-tile]")?.className)
      .toContain("bg-diff-chat-turn-icon-surface");
    expect(screen.getByText("decision.md")).toBeTruthy();
    expect(screen.getByText("Document · MD")).toBeTruthy();
    expect(screen.getByText("Open preview")).toBeTruthy();
    expect(fileActionMocks.inputs).toContainEqual({
      rawPath: "/repo/specs/decision.md:42",
    });

    fireEvent.click(screen.getByRole("button", { name: "Open preview for decision.md" }));
    expect(fileActionMocks.openPrimary).toHaveBeenCalledOnce();
  });

  it("disables the unavailable primary action and guards its handler", () => {
    fileActionMocks.canOpenPrimary = false;
    render(
      <TurnDocumentReferenceCard
        resource={{
          rawPath: "/repo/specs/missing.md",
          path: "/repo/specs/missing.md",
          displayName: "missing.md",
          typeLabel: "Document · MD",
        }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Open preview for missing.md",
    });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(fileActionMocks.openPrimary).not.toHaveBeenCalled();
  });
});
