import type { ErrorEvent, EventHint, Exception, StackFrame } from "@sentry/react";
import {
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
  isExpectedControlPlaneProbeTimeoutError,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";

const UNHANDLED_REJECTION_MECHANISM =
  "auto.browser.global_handlers.onunhandledrejection";

type ExceptionWithRawStacktrace = Exception & {
  raw_stacktrace?: { frames?: StackFrame[] };
};

function hasUnhandledRejectionMechanism(exception: Exception): boolean {
  return exception.mechanism?.type === UNHANDLED_REJECTION_MECHANISM
    && exception.mechanism.handled === false;
}

function frameMatchesMethod(frame: StackFrame, method: string): boolean {
  const functionName = frame.function;
  if (!functionName) {
    return false;
  }
  if (method === "cancel") {
    return functionName.endsWith("[as cancel]");
  }
  return functionName === method || functionName.endsWith(`.${method}`);
}

function findMethodAfter(
  frames: StackFrame[],
  method: string,
  startIndex: number,
): number {
  return frames.findIndex((frame, index) => (
    index >= startIndex && frameMatchesMethod(frame, method)
  ));
}

function hasExpectedTanStackObserverCancellation(
  exception: ExceptionWithRawStacktrace,
): boolean {
  if (
    exception.type !== "AbortError"
    || exception.value !== "signal is aborted without reason"
  ) {
    return false;
  }

  const frames = exception.raw_stacktrace?.frames ?? exception.stacktrace?.frames ?? [];
  if (frames.length < 6) {
    return false;
  }

  const setQueriesIndex = findMethodAfter(frames, "setQueries", 0);
  const batchIndex = findMethodAfter(frames, "batch", setQueriesIndex + 1);
  const tail = frames.slice(-4);

  return setQueriesIndex >= 0
    && batchIndex > setQueriesIndex
    && frameMatchesMethod(tail[0], "destroy")
    && frameMatchesMethod(tail[1], "removeObserver")
    && frameMatchesMethod(tail[2], "cancel")
    && frameMatchesMethod(tail[3], "onCancel");
}

/**
 * Drops only source-marked control-plane timeouts and the exact TanStack
 * observer teardown seen in hosted Web. Generic AbortErrors stay actionable.
 */
export function shouldDropExpectedWebSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const exceptions = event.exception?.values as ExceptionWithRawStacktrace[] | undefined;
  if (exceptions?.length !== 1) {
    return false;
  }

  const exception = exceptions[0];
  if (!hasUnhandledRejectionMechanism(exception)) {
    return false;
  }

  const isMarkedProbeTimeout =
    exception.type === EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME
    || isExpectedControlPlaneProbeTimeoutError(hint.originalException);

  return isMarkedProbeTimeout || hasExpectedTanStackObserverCancellation(exception);
}
