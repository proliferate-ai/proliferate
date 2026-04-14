import { logRendererDiagnostic } from "@/platform/tauri/diagnostics";

const DEDUPE_WINDOW_MS = 3_000;

const seenObjects = new WeakSet<object>();
const seenFingerprints = new Map<string, number>();
let listenersInstalled = false;

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

function shouldLogDiagnostic(
  dedupeKey: unknown,
  fingerprint: string,
): boolean {
  const now = Date.now();
  for (const [entry, timestamp] of seenFingerprints) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      seenFingerprints.delete(entry);
    }
  }

  if (dedupeKey && typeof dedupeKey === "object") {
    if (seenObjects.has(dedupeKey)) {
      return false;
    }
    seenObjects.add(dedupeKey);
  }

  const previous = seenFingerprints.get(fingerprint);
  if (previous && now - previous < DEDUPE_WINDOW_MS) {
    return false;
  }

  seenFingerprints.set(fingerprint, now);
  return true;
}

async function sendDiagnostic(
  source: string,
  error: unknown,
  dedupeKey: unknown,
  componentStack?: string | null,
) {
  const message = messageFromUnknown(error);
  const stack = stackFromUnknown(error);
  const fingerprint = buildFingerprint(source, message, stack, componentStack ?? null);
  if (!shouldLogDiagnostic(dedupeKey, fingerprint)) {
    return;
  }

  try {
    await logRendererDiagnostic({
      source,
      message,
      stack,
      componentStack: componentStack ?? null,
      route: currentRoute(),
    });
  } catch (invokeError) {
    if (import.meta.env.DEV) {
      console.warn("Failed to persist renderer diagnostic", invokeError);
    }
  }
}

export function initializeDesktopNativeDiagnostics(): void {
  if (listenersInstalled || typeof window === "undefined") {
    return;
  }

  listenersInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message);
    void sendDiagnostic("window.error", error, event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    void sendDiagnostic("unhandledrejection", event.reason, event.reason);
  });
}

export function reportReactRenderError(
  error: Error,
  componentStack?: string | null,
): void {
  void sendDiagnostic("react.render", error, error, componentStack);
}
