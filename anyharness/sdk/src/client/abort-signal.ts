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
const hasNonTrappingBrandCheck = captureNonTrappingBrandCheck();
const nodeProxyDetector = hasNonTrappingBrandCheck
  ? undefined
  : loadNodeProxyDetector();

const CANCELLATION_PROPERTIES = [
  "aborted",
  "reason",
  "addEventListener",
  "removeEventListener",
] as const;

export async function isNativeAbortSignal(value: unknown): Promise<boolean> {
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
    // Standards hosts reject a Proxy through AbortSignal's Web-IDL brand
    // before entering caller traps. Hosts whose getter forwards through a
    // Proxy must first obtain Node's non-trapping detector from the real
    // built-in module loader. No caller value reaches module loading.
    if (!hasNonTrappingBrandCheck) {
      const detector = await nodeProxyDetector;
      if (!detector || detector(value)) {
        return false;
      }
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
 * Determine whether this realm's AbortSignal getter is itself a safe first
 * brand check. The probe uses only an SDK-created signal and SDK-owned traps;
 * it never observes a caller value or an ambient runtime marker.
 */
function captureNonTrappingBrandCheck(): boolean {
  if (!abortSignalAbortedGetter) {
    return false;
  }
  let enteredTrap = false;
  const rejectTrap = (): never => {
    enteredTrap = true;
    throw new TypeError("AbortSignal brand probe entered a Proxy trap");
  };
  try {
    const probe = new Proxy(new AbortController().signal, {
      get: rejectTrap,
      getOwnPropertyDescriptor: rejectTrap,
      getPrototypeOf: rejectTrap,
      has: rejectTrap,
      isExtensible: rejectTrap,
      ownKeys: rejectTrap,
    });
    reflectApply(abortSignalAbortedGetter, probe, []);
    return false;
  } catch {
    return !enteredTrap;
  }
}

/**
 * Load Node's detector through the reserved `node:` module namespace. The
 * ignored dynamic import remains runtime-only in browser bundles; standards
 * hosts never execute it because their local brand check is non-trapping.
 */
async function loadNodeProxyDetector(): Promise<NodeProxyDetector | undefined> {
  try {
    const specifier = "node:util";
    const util = await import(/* @vite-ignore */ specifier) as {
      types?: { isProxy?: unknown };
    };
    const types = util.types;
    const detector = types?.isProxy;
    if (!types || typeof detector !== "function") {
      return undefined;
    }
    return (value: object): boolean => (
      reflectApply(detector, types, [value]) === true
    );
  } catch {
    return undefined;
  }
}
