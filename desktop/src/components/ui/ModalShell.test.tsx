// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalShell } from "@/components/ui/ModalShell";
import { useNativeOverlayOpen } from "@/hooks/ui/use-native-overlay-presence";

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
});
