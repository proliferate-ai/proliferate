import { logRendererDiagnostic } from "@/lib/access/tauri/diagnostics";
import { getRuntimeDesktopAppConfig } from "@/lib/infra/proliferate-api";

const DEDUPE_WINDOW_MS = 3_000;

const successfulDiagnostics = new Map<string, number>();
const inFlightDiagnostics = new Map<string, Promise<boolean>>();
let listenersInstalled = false;

const STACKLESS_NETWORK_REJECTION_MESSAGES = new Set([
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
]);

function currentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.location.pathname;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stackFromUnknown(error: unknown): string | null {
  return error instanceof Error && typeof error.stack === "string"
    ? error.stack
    : null;
}

function buildFingerprint(
  source: string,
  message: string,
  stack: string | null,
  componentStack: string | null,
): string {
  return [source, message, stack ?? "", componentStack ?? ""].join("\n::\n");
}

function hasRecentSuccessfulDiagnostic(fingerprint: string): boolean {
  const now = Date.now();
  for (const [entry, completedAt] of successfulDiagnostics) {
    if (now - completedAt >= DEDUPE_WINDOW_MS) {
      successfulDiagnostics.delete(entry);
    }
  }

  return successfulDiagnostics.has(fingerprint);
}

function shouldSuppressDiagnostic(
  source: string,
  error: unknown,
  message: string,
  stack: string | null,
  componentStack: string | null,
): boolean {
  return (import.meta.env.DEV || getRuntimeDesktopAppConfig().nativeDevProfile)
    && source === "unhandledrejection"
    && error instanceof TypeError
    && stack === null
    && componentStack === null
    && STACKLESS_NETWORK_REJECTION_MESSAGES.has(message);
}

function sendDiagnostic(
  source: string,
  error: unknown,
  componentStack?: string | null,
): Promise<boolean> {
  const message = messageFromUnknown(error);
  const stack = stackFromUnknown(error);
  if (shouldSuppressDiagnostic(source, error, message, stack, componentStack ?? null)) {
    return Promise.resolve(false);
  }

  const fingerprint = buildFingerprint(source, message, stack, componentStack ?? null);
  const inFlight = inFlightDiagnostics.get(fingerprint);
  if (inFlight) {
    return inFlight;
  }
  if (hasRecentSuccessfulDiagnostic(fingerprint)) {
    // An identical diagnostic was already persisted inside the dedupe window.
    return Promise.resolve(true);
  }

  let nativePersistence: Promise<void>;
  try {
    nativePersistence = Promise.resolve(logRendererDiagnostic({
      source,
      message,
      stack,
      componentStack: componentStack ?? null,
      route: currentRoute(),
    }));
  } catch (invokeError) {
    nativePersistence = Promise.reject(invokeError);
  }

  const persistence = nativePersistence.then(
    () => {
      successfulDiagnostics.set(fingerprint, Date.now());
      return true;
    },
    (invokeError) => {
      // Failed attempts never create a successful marker, so later callers
      // can retry regardless of object identity.
      if (import.meta.env.DEV) {
        console.warn("Failed to persist renderer diagnostic", invokeError);
      }
      return false;
    },
  ).finally(() => {
    if (inFlightDiagnostics.get(fingerprint) === persistence) {
      inFlightDiagnostics.delete(fingerprint);
    }
  });
  inFlightDiagnostics.set(fingerprint, persistence);
  return persistence;
}

export function initializeDesktopNativeDiagnostics(): void {
  if (listenersInstalled || typeof window === "undefined") {
    return;
  }

  listenersInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message);
    void sendDiagnostic("window.error", error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    void sendDiagnostic("unhandledrejection", event.reason);
  });
}

export function reportReactRenderError(
  error: Error,
  componentStack?: string | null,
): Promise<boolean> {
  return sendDiagnostic("react.render", error, componentStack);
}
