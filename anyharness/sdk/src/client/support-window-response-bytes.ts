import type {
  AnyHarnessEventSupportWindowV1,
  AnyHarnessRawNotificationSupportWindowV1,
  AnyHarnessSessionSupportWindowV1,
} from "../types/sessions.js";

const responseBytes = new WeakMap<object, number>();
type SupportWindowResponse =
  | AnyHarnessSessionSupportWindowV1
  | AnyHarnessEventSupportWindowV1
  | AnyHarnessRawNotificationSupportWindowV1;

export function retainSupportWindowResponseBytes<T extends object>(
  response: T,
  bodyBytes: number,
  maxResponseBytes: number,
): T {
  if (
    !Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes < 1
    || !Number.isSafeInteger(bodyBytes)
    || bodyBytes < 1
    || bodyBytes > maxResponseBytes
  ) {
    throw new TypeError("Invalid support-window response byte count");
  }
  responseBytes.set(response, bodyBytes);
  return response;
}

export function supportWindowResponseBytes(response: SupportWindowResponse): number {
  if (typeof response !== "object" || response === null) {
    throw new TypeError("Support-window response identity is required");
  }
  const bodyBytes = responseBytes.get(response);
  if (bodyBytes === undefined) {
    throw new TypeError("Support-window response byte count is unavailable");
  }
  return bodyBytes;
}
