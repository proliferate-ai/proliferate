// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnDocumentReferenceCard } from "#product/components/workspace/chat/transcript/TurnDocumentReferenceCard";

const { openPrimary } = vi.hoisted(() => ({ openPrimary: vi.fn() }));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: () => ({ openPrimary }),
}));

afterEach(() => {
  cleanup();
  openPrimary.mockReset();
});

describe("TurnDocumentReferenceCard", () => {
  it("renders a Codex-style document result and opens its preview", () => {
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
    expect(card?.className).toContain("bg-[var(--color-diff-panel-surface)]");
    expect(screen.getByText("decision.md")).toBeTruthy();
    expect(screen.getByText("Document · MD")).toBeTruthy();
    expect(screen.getByText("Open preview")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open preview for decision.md" }));
    expect(openPrimary).toHaveBeenCalledOnce();
  });
});
