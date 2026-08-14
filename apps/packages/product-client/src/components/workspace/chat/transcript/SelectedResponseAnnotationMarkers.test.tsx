// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectedSelectedResponseAnnotationMarkers } from "#product/components/workspace/chat/transcript/SelectedResponseAnnotationMarkers";

const mocks = vi.hoisted(() => ({
  contexts: [] as Array<{ id: string; text: string }>,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    selectedLogicalWorkspaceId: "logical-workspace-1",
    selectedWorkspaceId: "workspace-1",
  }),
}));

vi.mock("#product/hooks/chat/ui/use-chat-draft-state", () => ({
  useChatSelectedResponseContexts: () => mocks.contexts,
}));

// jsdom ranges have zero-size rects, which the real viewport check treats as
// scrolled out of view; the check itself is covered by the selection suite.
vi.mock("#product/hooks/chat/ui/selected-response-selection", () => ({
  isSelectedResponseInViewport: () => true,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  mocks.contexts = [];
});

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = "<div data-assistant-prose><p>alpha passage and beta passage</p></div>";
  document.body.append(root);
  return root;
}

describe("ConnectedSelectedResponseAnnotationMarkers", () => {
  it("pins a numbered marker over each attached annotation", async () => {
    const root = mountRoot();
    mocks.contexts = [
      { id: "a1", text: "alpha passage" },
      { id: "a2", text: "beta passage" },
    ];

    render(<ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />);

    await waitFor(() => {
      expect(screen.getByText("1")).not.toBeNull();
      expect(screen.getByText("2")).not.toBeNull();
    });
  });

  it("skips annotations whose text left the transcript and renders nothing when empty", async () => {
    const root = mountRoot();
    mocks.contexts = [{ id: "a1", text: "vanished excerpt" }];

    const { rerender } = render(
      <ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />,
    );
    await waitFor(() => {
      expect(document.querySelectorAll("[data-annotation-marker]")).toHaveLength(0);
    });

    mocks.contexts = [];
    rerender(<ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-annotation-marker]")).toHaveLength(0);
    });
  });
});
