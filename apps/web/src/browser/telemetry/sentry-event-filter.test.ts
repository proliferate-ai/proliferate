import { describe, expect, it } from "vitest";
import type { ErrorEvent, EventHint, StackFrame } from "@sentry/react";
import {
  createExpectedControlPlaneProbeTimeoutError,
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";

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
  return {
    type: undefined,
    exception: {
      values: [{
        mechanism: UNHANDLED_REJECTION,
        stacktrace: { frames },
        type,
        value,
      }],
    },
  };
}

const TANSTACK_OBSERVER_CANCEL_FRAMES: StackFrame[] = [
  { function: "wL.setQueries" },
  { function: "Object.batch" },
  { function: "anonymous" },
  { function: "bL.destroy" },
  { function: "vL.removeObserver" },
  { function: "Object.i [as cancel]" },
  { function: "Object.onCancel" },
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

  it("drops the exact TanStack observer cancellation stack", () => {
    const event = eventFor(
      "AbortError",
      "signal is aborted without reason",
      TANSTACK_OBSERVER_CANCEL_FRAMES,
    );

    expect(shouldDropExpectedWebSentryEvent(event, {})).toBe(true);
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

  it("preserves handled errors and other failures with the same stack", () => {
    const handled = eventFor(
      "AbortError",
      "signal is aborted without reason",
      TANSTACK_OBSERVER_CANCEL_FRAMES,
    );
    handled.exception!.values![0].mechanism = {
      handled: true,
      type: "auto.browser.global_handlers.onunhandledrejection",
    };
    const typeError = eventFor(
      "TypeError",
      "Request failed",
      TANSTACK_OBSERVER_CANCEL_FRAMES,
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
