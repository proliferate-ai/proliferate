// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNativeOverlayOpen } from "@/hooks/ui/use-native-overlay-presence";
import { ManualChatGroupEditorPopover } from "./ManualChatGroupEditorPopover";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function NativeOverlayObserver() {
  const open = useNativeOverlayOpen();
  return <div data-testid="native-overlay-state" data-open={String(open)} />;
}

describe("ManualChatGroupEditorPopover", () => {
  it("registers as a native overlay while mounted", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const rendered = render(
      <>
        <NativeOverlayObserver />
        <ManualChatGroupEditorPopover
          title="Edit group"
          anchorRect={{
            top: 10,
            right: 110,
            bottom: 30,
            left: 10,
            width: 100,
            height: 20,
          }}
          initialLabel="Group"
          initialColorId="blue"
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("true");
    });

    rendered.rerender(<NativeOverlayObserver />);

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");
    });
  });
});
