import { describe, expect, it } from "vitest";
import type { ErrorEvent, EventHint, Exception, StackFrame } from "@sentry/react";
import {
  createExpectedControlPlaneProbeTimeoutError,
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";
import {
  createExpectedSessionStreamStaleCloseError,
  EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME,
} from "@proliferate/product-domain/telemetry/session-stream-stale-close";

import { shouldDropExpectedWebSentryEvent } from "./sentry-event-filter";

const UNHANDLED_REJECTION = {
  handled: false,
  type: "auto.browser.global_handlers.onunhandledrejection",
} as const;

function eventFor(
  type: string,
  value: string,
  frames: StackFrame[] = [],
): ErrorEvent {
  const exception: Exception & { raw_stacktrace: { frames: StackFrame[] } } = {
    mechanism: UNHANDLED_REJECTION,
    raw_stacktrace: { frames },
    type,
    value,
  };
  return {
    type: undefined,
    exception: {
      values: [exception],
    },
  };
}

function eventForProcessedStack(
  type: string,
  value: string,
  frames: StackFrame[],
): ErrorEvent {
  const event = eventFor(type, value, frames);
  const exception = event.exception!.values![0] as Exception & {
    raw_stacktrace?: { frames: StackFrame[] };
  };
  delete exception.raw_stacktrace;
  exception.stacktrace = { frames };
  return event;
}

const TANSTACK_CANCELLATION_STACKS: { name: string; frames: StackFrame[] }[] = [
  {
    name: "queries observer teardown",
    frames: [
      { function: "wL.setQueries" },
      { function: "Object.batch" },
      { function: "anonymous" },
      { function: "bL.destroy" },
      { function: "vL.removeObserver" },
      { function: "Object.i [as cancel]" },
      { function: "Object.onCancel" },
    ],
  },
  {
    name: "observer options query replacement",
    frames: [
      { function: "bL.setOptions" },
      { function: "bL.#updateQuery" },
      { function: "vL.removeObserver" },
      { function: "Object.i [as cancel]" },
      { function: "Object.onCancel" },
    ],
  },
  {
    name: "terminal catalog refetch",
    frames: [
      { function: "bL.refetch" },
      { function: "bL.fetch" },
      { function: "vL.fetch" },
      { function: "vL.cancel" },
      { function: "Object.i [as cancel]" },
      { function: "Object.onCancel" },
    ],
  },
  {
    name: "stream-side-effect invalidation refetch",
    frames: [
      { function: "qL.invalidateQueries" },
      { function: "Object.batch" },
      { function: "qL.refetchQueries" },
      { function: "Object.batch" },
      { function: "vL.fetch" },
      { function: "vL.cancel" },
      { function: "Object.i [as cancel]" },
      { function: "Object.onCancel" },
    ],
  },
];

const STALE_SESSION_STREAM_CLOSE_FRAMES: StackFrame[] = [
  { function: "openSessionStream" },
  { function: "Object.onHandle" },
  { function: "Object.close" },
];

describe("shouldDropExpectedWebSentryEvent", () => {
  it("drops source-marked control-plane probe timeouts", () => {
    const serializedEvent = eventFor(
      EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
      "Control plane probe timed out.",
    );
    const hintedEvent = eventFor("Error", "Control plane probe timed out.");
    const hint = {
      originalException: createExpectedControlPlaneProbeTimeoutError(),
    } satisfies EventHint;

    expect(shouldDropExpectedWebSentryEvent(hintedEvent, hint)).toBe(true);
    expect(shouldDropExpectedWebSentryEvent(serializedEvent, {})).toBe(true);
  });

  it.each(TANSTACK_CANCELLATION_STACKS)("drops the exact $name raw stack", ({ frames }) => {
    const event = eventFor("AbortError", "signal is aborted without reason", frames);

    expect(shouldDropExpectedWebSentryEvent(event, {})).toBe(true);
  });

  it("keeps the browser stacktrace fallback for the original observer teardown", () => {
    const event = eventForProcessedStack(
      "AbortError",
      "signal is aborted without reason",
      TANSTACK_CANCELLATION_STACKS[0]!.frames,
    );

    expect(shouldDropExpectedWebSentryEvent(event, {})).toBe(true);
  });

  it("drops source-marked stale session stream closes", () => {
    const serializedEvent = eventFor(
      EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME,
      "Stale session stream connection closed.",
      STALE_SESSION_STREAM_CLOSE_FRAMES,
    );
    const hintedEvent = eventFor(
      "Error",
      "Stale session stream connection closed.",
      STALE_SESSION_STREAM_CLOSE_FRAMES,
    );
    const hint = {
      originalException: createExpectedSessionStreamStaleCloseError(),
    } satisfies EventHint;

    expect(shouldDropExpectedWebSentryEvent(serializedEvent, {})).toBe(true);
    expect(shouldDropExpectedWebSentryEvent(hintedEvent, hint)).toBe(true);
  });

  it("preserves generic probe and PostHog AbortErrors", () => {
    const genericProbe = eventFor("AbortError", "signal is aborted without reason", [
      { function: "r" },
    ]);
    const postHogTimeout = eventFor("AbortError", "signal is aborted without reason", [
      { function: "h.timeout" },
    ]);

    expect(shouldDropExpectedWebSentryEvent(genericProbe, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(postHogTimeout, {})).toBe(false);
  });

  it("preserves Cloud SDK SSE teardown and frame-less user aborts", () => {
    const sseTeardown = eventFor("AbortError", "signal is aborted without reason", [
      { function: "destroy_" },
      { function: "close" },
    ]);
    const userAbort = eventFor("Error", "AbortError: The user aborted a request.");

    expect(shouldDropExpectedWebSentryEvent(sseTeardown, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(userAbort, {})).toBe(false);
  });

  it("preserves same-named methods without a complete cancellation chain", () => {
    const incompleteStacks: StackFrame[][] = [
      TANSTACK_CANCELLATION_STACKS[0]!.frames.slice(1),
      TANSTACK_CANCELLATION_STACKS[0]!.frames.filter(
        (frame) => frame.function !== "Object.batch",
      ),
      TANSTACK_CANCELLATION_STACKS[0]!.frames.filter(
        (frame) => frame.function !== "bL.destroy",
      ),
      TANSTACK_CANCELLATION_STACKS[1]!.frames.filter(
        (frame) => frame.function !== "bL.setOptions",
      ),
      TANSTACK_CANCELLATION_STACKS[1]!.frames.filter(
        (frame) => frame.function !== "vL.removeObserver",
      ),
      TANSTACK_CANCELLATION_STACKS[2]!.frames.filter(
        (frame) => !frame.function?.endsWith(".fetch"),
      ),
      TANSTACK_CANCELLATION_STACKS[2]!.frames.filter(
        (frame) => frame.function !== "vL.cancel",
      ),
      TANSTACK_CANCELLATION_STACKS[3]!.frames.filter(
        (frame) => frame.function !== "qL.invalidateQueries",
      ),
      TANSTACK_CANCELLATION_STACKS[3]!.frames.filter(
        (frame) => frame.function !== "qL.refetchQueries",
      ),
      TANSTACK_CANCELLATION_STACKS[3]!.frames.filter(
        (frame) => frame.function !== "vL.cancel",
      ),
      [
        ...TANSTACK_CANCELLATION_STACKS[3]!.frames,
        { function: "transportFailure" },
      ],
      [
        { function: "qL.refetchQueries" },
        { function: "qL.invalidateQueries" },
        { function: "vL.cancel" },
        { function: "Object.i [as cancel]" },
        { function: "Object.onCancel" },
      ],
      ...TANSTACK_CANCELLATION_STACKS.map(({ frames }) => frames.filter(
        (frame) => frame.function !== "Object.i [as cancel]",
      )),
      ...TANSTACK_CANCELLATION_STACKS.map(({ frames }) => frames.filter(
        (frame) => frame.function !== "Object.onCancel",
      )),
    ];

    for (const frames of incompleteStacks) {
      expect(shouldDropExpectedWebSentryEvent(eventFor(
        "AbortError",
        "signal is aborted without reason",
        frames,
      ), {})).toBe(false);
    }
  });

  it("preserves real transport failures", () => {
    const failedFetch = eventFor("TypeError", "Failed to fetch", [
      { function: "fetch" },
      { function: "request" },
    ]);
    const unmarkedStreamAbort = eventFor(
      "AbortError",
      "signal is aborted without reason",
      STALE_SESSION_STREAM_CLOSE_FRAMES,
    );
    const refetchTransportAbort = eventFor(
      "AbortError",
      "signal is aborted without reason",
      [
        { function: "bL.refetch" },
        { function: "bL.fetch" },
        { function: "globalThis.fetch" },
        { function: "request" },
      ],
    );

    expect(shouldDropExpectedWebSentryEvent(failedFetch, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(unmarkedStreamAbort, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(refetchTransportAbort, {})).toBe(false);
  });

  it("preserves handled errors and other failures with the same stack", () => {
    const handled = eventFor(
      "AbortError",
      "signal is aborted without reason",
      TANSTACK_CANCELLATION_STACKS[0]!.frames,
    );
    handled.exception!.values![0].mechanism = {
      handled: true,
      type: "auto.browser.global_handlers.onunhandledrejection",
    };
    const typeError = eventFor(
      "TypeError",
      "Request failed",
      TANSTACK_CANCELLATION_STACKS[0]!.frames,
    );
    const differentlyWordedAbort = eventFor(
      "AbortError",
      "The operation was aborted.",
      TANSTACK_CANCELLATION_STACKS[0]!.frames,
    );
    const handledProbeTimeout = eventFor(
      EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
      "Control plane probe timed out.",
    );
    handledProbeTimeout.exception!.values![0].mechanism = {
      handled: true,
      type: "auto.browser.global_handlers.onunhandledrejection",
    };

    expect(shouldDropExpectedWebSentryEvent(handled, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(typeError, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(differentlyWordedAbort, {})).toBe(false);
    expect(shouldDropExpectedWebSentryEvent(handledProbeTimeout, {})).toBe(false);
  });

  it("preserves mixed exception chains", () => {
    const event = eventFor(
      EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
      "Control plane probe timed out.",
    );
    event.exception!.values!.push({
      mechanism: UNHANDLED_REJECTION,
      type: "TypeError",
      value: "Actionable failure",
    });

    expect(shouldDropExpectedWebSentryEvent(event, {
      originalException: createExpectedControlPlaneProbeTimeoutError(),
    })).toBe(false);
  });
});
