// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedSelectedResponseAnnotationComposer,
  SelectedResponseAnnotationComposer,
} from "#product/components/workspace/chat/transcript/SelectedResponseAnnotationComposer";
import type { SelectedResponsePendingAnnotation } from "#product/components/workspace/chat/transcript/SelectedResponseActionMenu";

const mocks = vi.hoisted(() => ({
  setAnnotationComment: vi.fn(),
  focusComposer: vi.fn(),
}));

vi.mock("#product/hooks/chat/workflows/use-selected-response-actions", () => ({
  useSelectedResponseActions: () => ({
    addToChat: vi.fn(),
    moreDetails: vi.fn(),
    setAnnotationComment: mocks.setAnnotationComment,
    focusComposer: mocks.focusComposer,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SelectedResponseAnnotationComposer", () => {
  it("shows the annotation ordinal and takes focus", async () => {
    render(
      <SelectedResponseAnnotationComposer annotation={annotation} onSettle={vi.fn()} />,
    );

    expect(screen.getByText("2")).not.toBeNull();
    const input = screen.getByLabelText("Annotation comment");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("commits the typed comment on Enter and hands focus to the composer", () => {
    const onSettle = vi.fn();
    render(
      <SelectedResponseAnnotationComposer annotation={annotation} onSettle={onSettle} />,
    );
    const input = screen.getByLabelText("Annotation comment");

    fireEvent.change(input, { target: { value: "focus here" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSettle).toHaveBeenCalledExactlyOnceWith("focus here", { focusComposer: true });
  });

  it("cancels on Escape without keeping the typed text", () => {
    const onSettle = vi.fn();
    render(
      <SelectedResponseAnnotationComposer annotation={annotation} onSettle={onSettle} />,
    );
    const input = screen.getByLabelText("Annotation comment");

    fireEvent.change(input, { target: { value: "discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onSettle).toHaveBeenCalledExactlyOnceWith("", { focusComposer: true });
  });

  it("commits via the send button with the composer focus handoff", () => {
    const onSettle = vi.fn();
    render(
      <SelectedResponseAnnotationComposer annotation={annotation} onSettle={onSettle} />,
    );
    const input = screen.getByLabelText("Annotation comment");
    const submit = screen.getByLabelText("Save annotation");

    fireEvent.change(input, { target: { value: "from the button" } });
    // The press must not blur the input first: blur would settle WITHOUT the
    // composer focus handoff, and the settle guard only lets the first
    // outcome through.
    const pointerDown = new window.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    fireEvent(submit, pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    fireEvent.click(submit);

    expect(onSettle).toHaveBeenCalledExactlyOnceWith("from the button", { focusComposer: true });
  });

  it("commits on blur without stealing focus, and settles only once", () => {
    const onSettle = vi.fn();
    render(
      <SelectedResponseAnnotationComposer annotation={annotation} onSettle={onSettle} />,
    );
    const input = screen.getByLabelText("Annotation comment");

    fireEvent.change(input, { target: { value: "typed" } });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSettle).toHaveBeenCalledExactlyOnceWith("typed", { focusComposer: false });
  });

  it("saves non-empty comments through the connected wrapper and reports done", () => {
    const onDone = vi.fn();
    render(
      <ConnectedSelectedResponseAnnotationComposer annotation={annotation} onDone={onDone} />,
    );
    const input = screen.getByLabelText("Annotation comment");

    fireEvent.change(input, { target: { value: "note" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.setAnnotationComment).toHaveBeenCalledWith("annotation-1", "note");
    expect(mocks.focusComposer).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("skips the comment write for blur with nothing typed", () => {
    const onDone = vi.fn();
    render(
      <ConnectedSelectedResponseAnnotationComposer annotation={annotation} onDone={onDone} />,
    );

    fireEvent.blur(screen.getByLabelText("Annotation comment"));

    expect(mocks.setAnnotationComment).not.toHaveBeenCalled();
    expect(mocks.focusComposer).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });
});

const annotation: SelectedResponsePendingAnnotation = {
  id: "annotation-1",
  ordinal: 2,
  anchorRect: {
    x: 100,
    y: 120,
    width: 160,
    height: 24,
    top: 120,
    right: 260,
    bottom: 144,
    left: 100,
  },
};
