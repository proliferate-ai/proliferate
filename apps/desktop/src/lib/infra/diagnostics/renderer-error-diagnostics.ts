import {
  diagnosticField,
  type RendererDiagnosticInput,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";

import { getRuntimeDesktopAppConfig } from "@/lib/infra/proliferate-api";
import { emitRendererDiagnosticAcknowledged } from "./renderer-diagnostics";
import { filterRendererDiagnosticText } from "./renderer-diagnostic-text";

const DEDUPE_WINDOW_MS = 3_000;
const MAX_SUCCESSFUL_FINGERPRINTS = 128;
const MAX_IN_FLIGHT_FINGERPRINTS = 256;

const successfulDiagnostics = new Map<string, number>();
const inFlightDiagnostics = new Map<string, Promise<boolean>>();
let listenersInstalled = false;

const STACKLESS_NETWORK_REJECTION_MESSAGES = new Set([
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
]);
const MAX_STACKLESS_NETWORK_REJECTION_MESSAGE_LENGTH = Math.max(
  ...Array.from(STACKLESS_NETWORK_REJECTION_MESSAGES, (value) => value.length),
);

type RendererErrorSource = "window" | "unhandled_rejection" | "react_render";

function messageFromUnknown(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const message = ownDescriptor(error, "message");
    if (message && "value" in message && typeof message.value === "string") {
      return message.value;
    }
  }
  return "[non-error rejection]";
}

function stackFromUnknown(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const stack = ownDescriptor(error, "stack");
  return stack && "value" in stack && typeof stack.value === "string"
    ? stack.value
    : null;
}

function ownDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function buildFingerprint(
  source: RendererErrorSource,
  message: string,
  stack: string | null,
  componentStack: string | null,
): string {
  return JSON.stringify([
    source,
    fingerprintText(message, 16_384),
    stack === null ? null : fingerprintText(stack, 4_096),
    componentStack === null ? null : fingerprintText(componentStack, 4_096),
  ]);
}

function fingerprintText(value: string, maxBytes: number): readonly [string, boolean] {
  const filtered = filterRendererDiagnosticText(value, maxBytes);
  return [filtered.value, filtered.structural];
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

function rememberSuccessfulDiagnostic(fingerprint: string): void {
  if (successfulDiagnostics.size >= MAX_SUCCESSFUL_FINGERPRINTS) {
    const oldest = successfulDiagnostics.keys().next().value;
    if (oldest !== undefined) {
      successfulDiagnostics.delete(oldest);
    }
  }
  successfulDiagnostics.set(fingerprint, Date.now());
}

function shouldSuppressDiagnostic(
  source: RendererErrorSource,
  error: unknown,
  message: string,
  stack: string | null,
  componentStack: string | null,
): boolean {
  let nativeDevProfile = false;
  try {
    nativeDevProfile = getRuntimeDesktopAppConfig().nativeDevProfile;
  } catch {
    // Suppression is best-effort; reporting remains available during bootstrap.
  }
  let isTypeError = false;
  try {
    isTypeError = error instanceof TypeError;
  } catch {
    // Hostile proxies cannot participate in the narrow dev-only suppression.
  }
  return (import.meta.env.DEV || nativeDevProfile)
    && source === "unhandled_rejection"
    && isTypeError
    && stack === null
    && componentStack === null
    && message.length <= MAX_STACKLESS_NETWORK_REJECTION_MESSAGE_LENGTH
    && STACKLESS_NETWORK_REJECTION_MESSAGES.has(message);
}

function diagnosticInput(
  source: RendererErrorSource,
  message: string,
  stack: string | null,
  componentStack: string | null,
): RendererDiagnosticInput {
  const name = `renderer.error.${source}`;
  const fields = {
    message: diagnosticField(message, "sensitive"),
    ...(stack === null ? {} : { stack: diagnosticField(stack, "sensitive") }),
    ...(componentStack === null
      ? {}
      : { component_stack: diagnosticField(componentStack, "sensitive") }),
  };
  return {
    name,
    severity: "error",
    kind: "message",
    message,
    privacy: "sensitive",
    fields,
    errorClassification: source === "window"
      ? "window_error"
      : source === "unhandled_rejection"
        ? "unhandled_rejection"
        : "react_render_error",
  };
}

function sendDiagnostic(
  source: RendererErrorSource,
  error: unknown,
  componentStack?: string | null,
): Promise<boolean> {
  let message: string;
  let stack: string | null;
  let safeComponentStack: string | null;
  try {
    message = messageFromUnknown(error);
    stack = stackFromUnknown(error);
    safeComponentStack = typeof componentStack === "string" ? componentStack : null;
    if (shouldSuppressDiagnostic(source, error, message, stack, safeComponentStack)) {
      return Promise.resolve(false);
    }
  } catch {
    return Promise.resolve(false);
  }

  const fingerprint = buildFingerprint(source, message, stack, safeComponentStack);
  const inFlight = inFlightDiagnostics.get(fingerprint);
  if (inFlight) {
    return inFlight;
  }
  if (hasRecentSuccessfulDiagnostic(fingerprint)) {
    return Promise.resolve(true);
  }

  let emission: Promise<boolean>;
  try {
    emission = Promise.resolve(emitRendererDiagnosticAcknowledged(
      diagnosticInput(source, message, stack, safeComponentStack),
      500,
    ));
  } catch {
    emission = Promise.resolve(false);
  }
  const result = emission.then((accepted) => {
    if (accepted) {
      rememberSuccessfulDiagnostic(fingerprint);
    }
    return accepted;
  }).catch(() => false).finally(() => {
    if (inFlightDiagnostics.get(fingerprint) === result) {
      inFlightDiagnostics.delete(fingerprint);
    }
  });
  if (inFlightDiagnostics.size < MAX_IN_FLIGHT_FINGERPRINTS) {
    inFlightDiagnostics.set(fingerprint, result);
  }
  return result;
}

export function initializeDesktopRendererErrorDiagnostics(): void {
  if (listenersInstalled || typeof window === "undefined") {
    return;
  }
  listenersInstalled = true;
  window.addEventListener("error", (event) => {
    try {
      const error = event.error ?? event.message;
      void sendDiagnostic("window", error);
    } catch {
      // Global error reporting cannot affect the browser error surface.
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    try {
      void sendDiagnostic("unhandled_rejection", event.reason);
    } catch {
      // Global error reporting cannot affect the rejection surface.
    }
  });
}

export function reportReactRenderError(
  error: unknown,
  componentStack?: string | null,
): Promise<boolean> {
  return sendDiagnostic("react_render", error, componentStack);
}

export function resetRendererErrorDiagnosticsForTest(): void {
  successfulDiagnostics.clear();
  inFlightDiagnostics.clear();
  listenersInstalled = false;
}
