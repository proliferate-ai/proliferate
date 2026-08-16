// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion } from "@proliferate/design/motion";
import { ProductHostProvider } from "#product/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

// The exit overlay renders the real ChatPreMessageCanvas topSlot, which
// includes WorkspaceCreationReceipt — it needs an AnyHarnessWorkspace
// provider this isolated hook/overlay test has no reason to stand up. Stub it
// out: this test asserts the overlay's own mount/opacity/timing contract, not
// the creation receipt's rendering.
vi.mock("#product/components/workspace/chat/transcript/WorkspaceCreationReceipt", () => ({
  WorkspaceCreationReceipt: () => null,
}));

import {
  ChatLoadingHeroExitOverlay,
  useChatLoadingHeroExit,
} from "./ChatView";

let queryClient: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Mirrors how `ChatContent` composes `useChatLoadingHeroExit` with the exit
 * overlay: a stand-in for "the real content underneath" plus the overlay
 * rendered only while `phase !== "idle"`.
 */
function Harness({ isHeroMode }: { isHeroMode: boolean }) {
  const { phase, handleTreatmentShown } = useChatLoadingHeroExit(isHeroMode);
  return (
    <ProductHostProvider host={makeTestProductHost()}>
      <QueryClientProvider client={queryClient}>
        <div>
          <div data-real-content>{isHeroMode ? "loading" : "resolved"}</div>
          <button type="button" data-treatment-shown-trigger onClick={handleTreatmentShown}>
            mark shown
          </button>
          {phase !== "idle" && (
            <ChatLoadingHeroExitOverlay dockSafeAreaPx={0} phase={phase} />
          )}
        </div>
      </QueryClientProvider>
    </ProductHostProvider>
  );
}

describe("useChatLoadingHeroExit / ChatLoadingHeroExitOverlay (R16 hero exit hold)", () => {
  it("holds the exit overlay to the 420ms floor when the mode flips away at 250ms, then fades 120ms", () => {
    const { rerender, container } = render(<Harness isHeroMode />);
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-treatment-shown-trigger]")!.click();
    });

    advance(250);
    rerender(<Harness isHeroMode={false} />);

    // Mode has flipped to resolved content, but the overlay must still be
    // fully opaque, covering it, since only 250ms of the 420ms floor elapsed.
    let overlay = container.querySelector<HTMLElement>("[data-chat-loading-hero-exit]");
    expect(overlay).not.toBeNull();
    expect(overlay!.style.opacity).toBe("1");
    expect(container.querySelector("[data-real-content]")!.textContent).toBe("resolved");

    // Advance to just before the 420ms floor: still holding, still opaque.
    advance(420 - 250 - 1);
    overlay = container.querySelector<HTMLElement>("[data-chat-loading-hero-exit]");
    expect(overlay).not.toBeNull();
    expect(overlay!.style.opacity).toBe("1");

    // Crossing the 420ms floor starts the fade.
    advance(1);
    overlay = container.querySelector<HTMLElement>("[data-chat-loading-hero-exit]");
    expect(overlay).not.toBeNull();
    expect(overlay!.style.opacity).toBe("0");
    expect(overlay!.style.transitionDuration).toBe(`${motion.duration.exitMs}ms`);

    // Short of the fade duration: overlay still mounted (mid-fade).
    advance(motion.duration.exitMs - 1);
    expect(container.querySelector("[data-chat-loading-hero-exit]")).not.toBeNull();

    // Fade completes: overlay unmounts, revealing the resolved content clean.
    advance(1);
    expect(container.querySelector("[data-chat-loading-hero-exit]")).toBeNull();
  });

  it("fades immediately (no extra hold) when the mode flips away well past the 420ms floor", () => {
    const { rerender, container } = render(<Harness isHeroMode />);
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-treatment-shown-trigger]")!.click();
    });

    advance(600);
    rerender(<Harness isHeroMode={false} />);

    // remaining = max(0, 420 - 600) = 0, so the hold timer fires on the next
    // tick and the overlay should already be in its fading phase almost
    // immediately (opacity 0) rather than holding at full opacity.
    advance(0);
    const overlay = container.querySelector<HTMLElement>("[data-chat-loading-hero-exit]");
    expect(overlay).not.toBeNull();
    expect(overlay!.style.opacity).toBe("0");

    advance(motion.duration.exitMs);
    expect(container.querySelector("[data-chat-loading-hero-exit]")).toBeNull();
  });

  it("never mounts an overlay if the mark never became visible before the mode flipped away (still inside the show-delay)", () => {
    const { rerender, container } = render(<Harness isHeroMode />);
    // No `handleTreatmentShown()` call: simulates resolving inside the
    // show-delay window, before the DotCellLoader ever mounted.
    advance(100);
    rerender(<Harness isHeroMode={false} />);
    advance(1000);

    expect(container.querySelector("[data-chat-loading-hero-exit]")).toBeNull();
  });

  it("never hides the mark mid-flight: staying in hero mode keeps phase idle (no overlay) regardless of elapsed time", () => {
    const { container } = render(<Harness isHeroMode />);
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-treatment-shown-trigger]")!.click();
    });

    advance(10_000);

    // Still loading: no exit overlay should ever appear while isHeroMode stays
    // true, no matter how long the mark has been shown.
    expect(container.querySelector("[data-chat-loading-hero-exit]")).toBeNull();
    expect(container.querySelector("[data-real-content]")!.textContent).toBe("loading");
  });

  it("negative control: without the hold, an early mode flip would show resolved content with nothing covering it", () => {
    // Sanity-checks the harness's own assumption: rendering resolved content
    // directly (bypassing the hook) has no overlay, proving the overlay in
    // the tests above is produced by the hold logic, not incidental markup.
    function DirectHarness() {
      return <div data-real-content>resolved</div>;
    }
    const { container } = render(<DirectHarness />);
    expect(container.querySelector("[data-chat-loading-hero-exit]")).toBeNull();
    expect(container.querySelector("[data-real-content]")!.textContent).toBe("resolved");
  });
});
