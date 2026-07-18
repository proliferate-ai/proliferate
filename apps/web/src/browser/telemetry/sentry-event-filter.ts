import type { ErrorEvent, EventHint, Exception, StackFrame } from "@sentry/react";
import {
  EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME,
  isExpectedControlPlaneProbeTimeoutError,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";
import {
  EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME,
  isExpectedSessionStreamStaleCloseError,
} from "@proliferate/product-domain/telemetry/session-stream-stale-close";

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
  return functionName === method || functionName.endsWith(`.${method}`);
}

function frameMatchesRetryerCancel(frame: StackFrame): boolean {
  return frame.function?.endsWith("[as cancel]") ?? false;
}

type FramePredicate = (frame: StackFrame) => boolean;

function hasOrderedFrameChain(
  frames: StackFrame[],
  predicates: FramePredicate[],
): boolean {
  let predicateIndex = 0;
  for (const frame of frames) {
    if (predicates[predicateIndex]?.(frame)) {
      predicateIndex += 1;
    }
  }
  return predicateIndex === predicates.length;
}

function hasExactFrameTail(
  frames: StackFrame[],
  predicates: FramePredicate[],
): boolean {
  if (frames.length < predicates.length) {
    return false;
  }
  const tail = frames.slice(-predicates.length);
  return predicates.every((predicate, index) => predicate(tail[index]));
}

const method = (name: string): FramePredicate =>
  (frame) => frameMatchesMethod(frame, name);

function hasExpectedQueriesObserverDestroyCancellation(
  frames: StackFrame[],
): boolean {
  return hasOrderedFrameChain(frames, [method("setQueries"), method("batch")])
    && hasExactFrameTail(frames, [
      method("destroy"),
      method("removeObserver"),
      frameMatchesRetryerCancel,
      method("onCancel"),
    ]);
}

function hasExpectedObserverSetOptionsCancellation(
  frames: StackFrame[],
): boolean {
  return hasOrderedFrameChain(frames, [method("setOptions"), method("removeObserver")])
    && hasExactFrameTail(frames, [
      method("removeObserver"),
      frameMatchesRetryerCancel,
      method("onCancel"),
    ]);
}

function hasExpectedObserverRefetchCancellation(
  frames: StackFrame[],
): boolean {
  return hasOrderedFrameChain(frames, [method("refetch"), method("fetch")])
    && hasExactFrameTail(frames, [
      method("cancel"),
      frameMatchesRetryerCancel,
      method("onCancel"),
    ]);
}

function hasExpectedInvalidationRefetchCancellation(
  frames: StackFrame[],
): boolean {
  return hasOrderedFrameChain(frames, [
    method("invalidateQueries"),
    method("refetchQueries"),
  ]) && hasExactFrameTail(frames, [
    method("cancel"),
    frameMatchesRetryerCancel,
    method("onCancel"),
  ]);
}

function hasExpectedTanStackCancellation(
  exception: ExceptionWithRawStacktrace,
): boolean {
  if (
    exception.type !== "AbortError"
    || exception.value !== "signal is aborted without reason"
  ) {
    return false;
  }

  const frames = exception.raw_stacktrace?.frames ?? exception.stacktrace?.frames ?? [];
  return hasExpectedQueriesObserverDestroyCancellation(frames)
    || hasExpectedObserverSetOptionsCancellation(frames)
    || hasExpectedObserverRefetchCancellation(frames)
    || hasExpectedInvalidationRefetchCancellation(frames);
}

/**
 * Drops only source-marked lifecycle cancellations and exact TanStack
 * cancellation chains seen in hosted Web. Generic AbortErrors stay actionable.
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
  const isMarkedStaleSessionStreamClose =
    exception.type === EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME
    || isExpectedSessionStreamStaleCloseError(hint.originalException);

  return isMarkedProbeTimeout
    || isMarkedStaleSessionStreamClose
    || hasExpectedTanStackCancellation(exception);
}
