const abortSignalPrototype = AbortSignal.prototype;
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  abortSignalPrototype,
  "aborted",
)?.get;
const abortSignalReasonGetter = Object.getOwnPropertyDescriptor(
  abortSignalPrototype,
  "reason",
)?.get;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;

const CANCELLATION_PROPERTIES = [
  "aborted",
  "reason",
  "addEventListener",
  "removeEventListener",
] as const;

export function isNativeAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (
    !abortSignalAbortedGetter
    || !abortSignalReasonGetter
    || typeof eventTargetAddEventListener !== "function"
    || typeof eventTargetRemoveEventListener !== "function"
  ) {
    return false;
  }
  try {
    // The intrinsic brand check rejects proxies before prototype/descriptor
    // inspection can enter any caller-owned proxy trap.
    reflectApply(abortSignalAbortedGetter, value, []);
    if (reflectApply(getPrototypeOf, Object, [value]) !== abortSignalPrototype) {
      return false;
    }
    for (let index = 0; index < CANCELLATION_PROPERTIES.length; index += 1) {
      if (
        reflectApply(getOwnPropertyDescriptor, Object, [
          value,
          CANCELLATION_PROPERTIES[index],
        ]) !== undefined
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function readNativeAbortSignalAborted(signal: AbortSignal): boolean {
  if (!abortSignalAbortedGetter) {
    throw new TypeError("AbortSignal.aborted is unavailable");
  }
  return reflectApply(abortSignalAbortedGetter, signal, []) as boolean;
}

export function readNativeAbortSignalReason(signal: AbortSignal): unknown {
  if (!abortSignalReasonGetter) {
    throw new TypeError("AbortSignal.reason is unavailable");
  }
  return reflectApply(abortSignalReasonGetter, signal, []) as unknown;
}

export function addNativeAbortListener(
  signal: AbortSignal,
  listener: EventListener,
): void {
  reflectApply(eventTargetAddEventListener, signal, [
    "abort",
    listener,
    { once: true },
  ]);
}

export function removeNativeAbortListener(
  signal: AbortSignal,
  listener: EventListener,
): void {
  reflectApply(eventTargetRemoveEventListener, signal, ["abort", listener]);
}
