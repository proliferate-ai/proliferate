// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  useNativeOverlayOpen,
  useNativeOverlayRegistration,
} from "@/hooks/ui/use-native-overlay-presence";

afterEach(() => {
  cleanup();
});

function NativeOverlayObserver() {
  const open = useNativeOverlayOpen();
  return <div data-testid="native-overlay-state" data-open={String(open)} />;
}

function NativeOverlayRegistrar({ active }: { active: boolean }) {
  useNativeOverlayRegistration(active);
  return null;
}

describe("useNativeOverlayPresence", () => {
  it("tracks a single active native overlay registration", async () => {
    const rendered = render(
      <>
        <NativeOverlayObserver />
        <NativeOverlayRegistrar active={false} />
      </>,
    );

    expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");

    rendered.rerender(
      <>
        <NativeOverlayObserver />
        <NativeOverlayRegistrar active />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("true");
    });

    rendered.rerender(
      <>
        <NativeOverlayObserver />
        <NativeOverlayRegistrar active={false} />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");
    });
  });

  it("stays active until every registered overlay closes", async () => {
    const rendered = render(
      <>
        <NativeOverlayObserver />
        <NativeOverlayRegistrar active />
        <NativeOverlayRegistrar active />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("true");
    });

    rendered.rerender(
      <>
        <NativeOverlayObserver />
        <NativeOverlayRegistrar active />
        <NativeOverlayRegistrar active={false} />
      </>,
    );

    expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("true");

    rendered.rerender(
      <>
        <NativeOverlayObserver />
        <NativeOverlayRegistrar active={false} />
        <NativeOverlayRegistrar active={false} />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");
    });
  });
});
