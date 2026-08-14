// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedSelectedResponseAnnotationMarkers } from "#product/components/workspace/chat/transcript/SelectedResponseAnnotationMarkers";

const mocks = vi.hoisted(() => ({
  contexts: [] as Array<{ id: string; text: string; comment?: string }>,
  removeSelectedResponseContext: vi.fn(),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    selectedLogicalWorkspaceId: "logical-workspace-1",
    selectedWorkspaceId: "workspace-1",
  }),
}));

vi.mock("#product/stores/chat/chat-input-store", () => ({
  useChatInputStore: (selector: (state: unknown) => unknown) => selector({
    removeSelectedResponseContext: mocks.removeSelectedResponseContext,
  }),
}));

vi.mock("#product/hooks/chat/ui/use-chat-draft-state", () => ({
  useChatSelectedResponseContexts: () => mocks.contexts,
}));

// jsdom has no custom-highlight registry; a Map plus a range-collecting stand-in
// lets the tests observe registration and cleanup.
class FakeHighlight {
  ranges: unknown[];
  constructor(...ranges: unknown[]) {
    this.ranges = ranges;
  }
}

beforeEach(() => {
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("CSS", { highlights: new Map() });
});

// jsdom ranges have zero-size rects, which the real viewport check treats as
// scrolled out of view; the check itself is covered by the selection suite.
vi.mock("#product/hooks/chat/ui/selected-response-selection", () => ({
  isSelectedResponseInViewport: () => true,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  mocks.contexts = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function highlightRegistry(): Map<string, FakeHighlight> {
  return (globalThis.CSS as unknown as { highlights: Map<string, FakeHighlight> }).highlights;
}

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

  it("paints the excerpts through the highlight registry and clears it on removal", async () => {
    const root = mountRoot();
    mocks.contexts = [{ id: "a1", text: "alpha passage" }];

    const { rerender, unmount } = render(
      <ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />,
    );
    await waitFor(() => {
      expect(highlightRegistry().get("annotation")?.ranges).toHaveLength(1);
    });

    mocks.contexts = [];
    rerender(<ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />);
    await waitFor(() => {
      expect(highlightRegistry().has("annotation")).toBe(false);
    });

    mocks.contexts = [{ id: "a1", text: "alpha passage" }];
    rerender(<ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />);
    await waitFor(() => {
      expect(highlightRegistry().has("annotation")).toBe(true);
    });
    unmount();
    expect(highlightRegistry().has("annotation")).toBe(false);
  });

  it("previews the comment on hover, or a muted no-comment note", async () => {
    const root = mountRoot();
    mocks.contexts = [
      { id: "a1", text: "alpha passage", comment: "tighten this" },
      { id: "a2", text: "beta passage" },
    ];

    render(<ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />);
    await waitFor(() => expect(screen.getByText("2")).not.toBeNull());

    fireEvent.mouseEnter(screen.getByText("1"));
    expect(screen.getByText("tighten this")).not.toBeNull();
    fireEvent.mouseLeave(screen.getByText("1"));
    expect(screen.queryByText("tighten this")).toBeNull();

    fireEvent.mouseEnter(screen.getByText("2"));
    expect(screen.getByText("No comment")).not.toBeNull();
  });

  it("removes a single annotation from the hover control", async () => {
    const root = mountRoot();
    mocks.contexts = [
      { id: "a1", text: "alpha passage" },
      { id: "a2", text: "beta passage" },
    ];

    render(<ConnectedSelectedResponseAnnotationMarkers rootRef={{ current: root }} />);
    await waitFor(() => expect(screen.getByText("2")).not.toBeNull());

    fireEvent.mouseEnter(screen.getByText("2"));
    fireEvent.click(screen.getByLabelText("Remove annotation"));

    expect(mocks.removeSelectedResponseContext).toHaveBeenCalledExactlyOnceWith(
      "logical-workspace-1",
      "a2",
    );
  });

  it("hides the badge whose comment editor is open", async () => {
    const root = mountRoot();
    mocks.contexts = [
      { id: "a1", text: "alpha passage" },
      { id: "a2", text: "beta passage" },
    ];

    render(
      <ConnectedSelectedResponseAnnotationMarkers
        rootRef={{ current: root }}
        suppressedAnnotationId="a2"
      />,
    );

    await waitFor(() => expect(screen.getByText("1")).not.toBeNull());
    expect(document.querySelectorAll("[data-annotation-marker]")).toHaveLength(1);
    // The suppressed excerpt keeps its highlight — only the badge yields to
    // the editor floating above it.
    expect(highlightRegistry().get("annotation")?.ranges).toHaveLength(2);
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
