/* @vitest-environment jsdom */

// Rung 11 (PRO-187, requirement R10 / design question Q8): pin-state
// transitions and programmatic-versus-user classification must reach the
// renderer diagnostics so a production scroll bug reproduces from logs
// alone. This file asserts ONLY the diagnostics wiring (observation-only,
// same choke points the engine already uses); the pin/classification
// BEHAVIOR itself stays covered by the pre-existing marker/session-stamp/
// compensation suites, which all still pass unchanged (no new writer, no
// behavior change).

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "./use-transcript-stick-to-bottom";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

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
  resetRendererDiagnosticsSinkForTest();
});

interface HarnessHandle {
  api: TranscriptStickToBottom;
  viewport: HTMLDivElement;
}

function renderHarness(sessionKey?: string): { current: HarnessHandle } {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({
      scrollRef,
      onScrollSample: vi.fn(),
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

  render(<Harness />);
  return {
    get current() {
      return handle.current!;
    },
  };
}

function setMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
  el.scrollTop = metrics.scrollTop;
}

function pinTransitionCalls(emit: ReturnType<typeof vi.fn>) {
  return emit.mock.calls
    .map(([input]: [{ name: string; correlation?: { sessionId?: string }; fields?: Record<string, { value: unknown }> }]) => input)
    .filter((input) => input.name === "renderer.transcript.pin_transition");
}

describe("useTranscriptStickToBottom diagnostics (rung 11, PRO-187)", () => {
  it("records the user-scroll-intent direction before the resulting pin transition, both correlated to the session", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const handle = renderHarness("session-42");
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.notifyUserScrollIntent(-1);
    });

    const names = emit.mock.calls.map(([input]) => input.name);
    expect(names).toContain("renderer.transcript.user_scroll_intent");
    expect(names).toContain("renderer.transcript.pin_transition");
    // Intent recorded strictly before the pin flip it causes, matching the
    // false-unpin / swallowed-scroll detections in ADR section 5.
    expect(names.indexOf("renderer.transcript.user_scroll_intent"))
      .toBeLessThan(names.indexOf("renderer.transcript.pin_transition"));

    const transitions = pinTransitionCalls(emit);
    expect(transitions[0]).toEqual(expect.objectContaining({
      correlation: { sessionId: "session-42" },
      fields: expect.objectContaining({
        pinned: { privacy: "operational", value: false },
        cause: { privacy: "operational", value: "user_intent_unpin" },
      }),
    }));
  });

  it("does not record a pin transition for a no-op setPinned call (state unchanged)", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const handle = renderHarness("session-1");

    // Already pinned by default; re-pinning via the button click is a no-op
    // transition and must not spam a transition record.
    act(() => {
      handle.current.api.handleScrollToBottomClick();
    });

    expect(pinTransitionCalls(emit)).toHaveLength(0);
  });

  it("labels a button-click re-pin distinctly from a leave-band unpin", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const handle = renderHarness("session-1");
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.notifyUserScrollIntent(-1);
    });
    act(() => {
      handle.current.api.handleScrollToBottomClick();
    });

    const transitions = pinTransitionCalls(emit);
    const causes = transitions.map((input) => input.fields?.cause.value);
    expect(causes).toEqual(["user_intent_unpin", "button_click"]);
  });

  it("falls back to an 'unknown' correlation when no sessionKey is supplied", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const handle = renderHarness();

    act(() => {
      handle.current.api.notifyUserScrollIntent(-1);
    });

    const transitions = pinTransitionCalls(emit);
    expect(transitions[0].correlation).toEqual({ sessionId: "unknown" });
  });
});
