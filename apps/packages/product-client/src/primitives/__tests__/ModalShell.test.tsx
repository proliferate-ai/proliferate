// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { useNativeOverlayOpen } from "#product/primitives/overlays/overlay-presence";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function NativeOverlayObserver() {
  const open = useNativeOverlayOpen();
  return <div data-testid="native-overlay-state" data-open={String(open)} />;
}

describe("ModalShell", () => {
  it("registers as a native overlay while open", async () => {
    const onClose = vi.fn();
    const rendered = render(
      <>
        <NativeOverlayObserver />
        <ModalShell open title="Dialog" onClose={onClose}>
          Content
        </ModalShell>
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("true");
    });

    rendered.rerender(
      <>
        <NativeOverlayObserver />
        <ModalShell open={false} title="Dialog" onClose={onClose}>
          Content
        </ModalShell>
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");
    });
  });

  it("can mark the portaled dialog panel as telemetry blocked", () => {
    render(
      <ModalShell open title="Support" onClose={vi.fn()} telemetryBlocked>
        Content
      </ModalShell>,
    );

    expect(screen.getByRole("dialog").getAttribute("data-telemetry-block")).toBe("true");
  });

  it("can hide the close button for focused system prompts", () => {
    render(
      <ModalShell open title="Restart" onClose={vi.fn()} showCloseButton={false}>
        Content
      </ModalShell>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("ConfirmationDialog", () => {
  it("focuses the confirm action on open so Enter confirms", async () => {
    render(
      <ConfirmationDialog
        open
        title="Revoke API key"
        description="Revoke this?"
        confirmLabel="Revoke key"
        confirmVariant="destructive"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Revoke key" });
    await waitFor(() => {
      expect(document.activeElement).toBe(confirm);
    });
  });
});
