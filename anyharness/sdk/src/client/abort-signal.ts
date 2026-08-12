const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
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
const nodeProxyDetector = captureNodeProxyDetector();

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
    // Node implements AbortSignal's brand in JavaScript, so a forwarding
    // Proxy can relay its private-symbol reads. Supported Node releases expose
    // the non-trapping proxy test below; it must run before the getter or any
    // reflection. Standards hosts use the Web-IDL internal-slot brand check
    // before reflection instead. A detected Node host without its detector
    // rejects closed rather than taking the standards-host path.
    if (nodeProxyDetector === null) {
      return false;
    }
    if (nodeProxyDetector?.(value)) {
      return false;
    }
    reflectApply(abortSignalAbortedGetter, value, []);

    // Support-window signals are deliberately local-realm only. This exact
    // prototype and no-shadow policy keeps every later cancellation operation
    // on the captured local AbortSignal/EventTarget intrinsics.
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

type NodeProxyDetector = (value: object) => boolean;

/**
 * Capture Node's non-trapping proxy detector without introducing a static
 * Node import into this browser-compatible SDK. A browser process shim does
 * not expose `getBuiltinModule`, so standards hosts take the Web-IDL path in
 * `isNativeAbortSignal`.
 */
function captureNodeProxyDetector(): NodeProxyDetector | null | undefined {
  let detectedNodeRuntime = false;
  try {
    const processDescriptor = reflectApply(
      getOwnPropertyDescriptor,
      Object,
      [globalThis, "process"],
    ) as PropertyDescriptor | undefined;
    if (!processDescriptor) {
      return undefined;
    }

    const processValue = "value" in processDescriptor
      ? processDescriptor.value as unknown
      : typeof processDescriptor.get === "function"
        ? reflectApply(processDescriptor.get, globalThis, []) as unknown
        : undefined;
    if (!isObjectOrFunction(processValue)) {
      return undefined;
    }

    const versions = ownDataProperty(processValue, "versions");
    const nodeVersion = isObjectOrFunction(versions)
      ? ownDataProperty(versions, "node")
      : undefined;
    detectedNodeRuntime = typeof nodeVersion === "string"
      && nodeVersion.length > 0;

    const getBuiltinModule = ownDataProperty(
      processValue,
      "getBuiltinModule",
    );
    if (typeof getBuiltinModule !== "function") {
      return detectedNodeRuntime ? null : undefined;
    }

    const utilModule = reflectApply(getBuiltinModule, processValue, [
      "util",
    ]) as unknown;
    if (!isObjectOrFunction(utilModule)) {
      return detectedNodeRuntime ? null : undefined;
    }
    const types = ownDataProperty(utilModule, "types");
    if (!isObjectOrFunction(types)) {
      return detectedNodeRuntime ? null : undefined;
    }
    const isProxy = ownDataProperty(types, "isProxy");
    if (typeof isProxy !== "function") {
      return detectedNodeRuntime ? null : undefined;
    }

    return (value: object): boolean => (
      reflectApply(isProxy, types, [value]) === true
    );
  } catch {
    return detectedNodeRuntime ? null : undefined;
  }
}

function ownDataProperty(value: object, property: string): unknown {
  const descriptor = reflectApply(getOwnPropertyDescriptor, Object, [
    value,
    property,
  ]) as PropertyDescriptor | undefined;
  return descriptor && "value" in descriptor
    ? descriptor.value as unknown
    : undefined;
}

function isObjectOrFunction(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null)
    || typeof value === "function"
  );
}
