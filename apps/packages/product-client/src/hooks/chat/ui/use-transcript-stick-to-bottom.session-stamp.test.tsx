/* @vitest-environment jsdom */

// Split out of use-transcript-stick-to-bottom.test.tsx (repo-shape max-lines):
// the submit-stamp / session-identity scoping scenarios (PRO-175) get their
// own harness (`renderStampHarness`) rather than the shared `renderHarness`
// used by the rest of the suite, so this file only duplicates the small slice
// of setup those scenarios actually need.

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "./use-transcript-stick-to-bottom";

let rafCallbacks: Array<FrameRequestCallback | null>;

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks[id - 1] = null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface HarnessHandle {
  api: TranscriptStickToBottom;
  viewport: HTMLDivElement;
}

interface StampHarnessProps {
  lastPromptSubmittedAtMs: number | null;
  sessionKey: string;
}

interface StampHarnessController {
  current: HarnessHandle;
  rerender: (props: StampHarnessProps) => void;
}

/**
 * Harness for the submit-stamp / session-identity interaction (PRO-175).
 * Exposes `lastPromptSubmittedAtMs` and `sessionKey` as rerender-able props so
 * a test can simulate a session switch (`sessionKey` changes on the same
 * render as `lastPromptSubmittedAtMs`) without unmounting the hook — mirroring
 * how the row lists never remount across a real session switch.
 */
function renderStampHarness(initial: StampHarnessProps): StampHarnessController {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness({ lastPromptSubmittedAtMs, sessionKey }: StampHarnessProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({
      scrollRef,
      onScrollSample: vi.fn(),
      lastPromptSubmittedAtMs,
      sessionKey,
    });
    return (
      <div
        ref={(node) => {
          scrollRef.current = node;
          if (node) {
            handle.current = { api, viewport: node };
          }
        }}
        data-testid="viewport"
      />
    );
  }

  const rendered = render(<Harness {...initial} />);
  return {
    get current() {
      return handle.current!;
    },
    rerender(props: StampHarnessProps) {
      rendered.rerender(<Harness {...props} />);
    },
  };
}

function setMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
  el.scrollTop = metrics.scrollTop;
}

/** Mimic AutoHideScrollArea forwarding the viewport's scroll event to the engine. */
function dispatchScroll(handle: { current: HarnessHandle }) {
  act(() => {
    handle.current.api.onViewportScroll(handle.current.viewport);
  });
}

/** A user scroll to a position, then the resulting scroll event reaching the engine. */
function userScroll(handle: { current: HarnessHandle }, scrollTop: number) {
  handle.current.viewport.scrollTop = scrollTop;
  dispatchScroll(handle);
}

describe("useTranscriptStickToBottom", () => {
  describe("submit-stamp session scoping (PRO-175)", () => {
    it("re-pins and snaps when the SAME session's stamp genuinely increases", () => {
      const handle = renderStampHarness({ lastPromptSubmittedAtMs: 100, sessionKey: "workspace:session-a" });
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 400 });
      userScroll(handle, 400);
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      // A real new submit in the same session: stamp increases, same sessionKey.
      act(() => {
        handle.rerender({ lastPromptSubmittedAtMs: 200, sessionKey: "workspace:session-a" });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(true);
      expect(viewport.scrollTop).toBe(1000);
    });

    it("does NOT re-pin on a session switch even when the incoming session's stamp is higher than the outgoing session's", () => {
      // Session A has no stamp; visiting it establishes a null baseline.
      const handle = renderStampHarness({ lastPromptSubmittedAtMs: null, sessionKey: "workspace:session-a" });
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 400 });
      userScroll(handle, 400);
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      // Switch to session B, which carries its OWN pre-existing stamp (e.g. an
      // old, already-settled submit still tracked as the session's current
      // stamp — unrelated to this visit). Without session scoping, the stale
      // `previous == null` comparison would treat this as a fresh submit and
      // misfire a re-pin/snap/glue with zero new content.
      act(() => {
        handle.rerender({ lastPromptSubmittedAtMs: 50, sessionKey: "workspace:session-b" });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(false);
      expect(viewport.scrollTop).toBe(400);

      // A genuinely new submit in session B (stamp increases within the SAME
      // sessionKey) must still re-pin normally.
      act(() => {
        handle.rerender({ lastPromptSubmittedAtMs: 150, sessionKey: "workspace:session-b" });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(true);
      expect(viewport.scrollTop).toBe(1000);
    });

    it("re-baselines to the incoming session's current stamp so a later switch to a THIRD, unrelated session does not misfire either", () => {
      // Session A (stamp 500) -> session B (no stamp) -> session C (stamp 10).
      // C's stamp (10) is lower than A's (500) but the naive "previous == null"
      // check after visiting B would still misfire without the session-scoped
      // re-baseline, since B leaves the ref at null.
      const handle = renderStampHarness({ lastPromptSubmittedAtMs: 500, sessionKey: "workspace:session-a" });
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 400 });
      userScroll(handle, 400);
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      act(() => {
        handle.rerender({ lastPromptSubmittedAtMs: null, sessionKey: "workspace:session-b" });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      act(() => {
        handle.rerender({ lastPromptSubmittedAtMs: 10, sessionKey: "workspace:session-c" });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(false);
      expect(viewport.scrollTop).toBe(400);
    });
  });
});
