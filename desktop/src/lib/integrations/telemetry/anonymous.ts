import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";
import {
  copyAnonymousUsageCounters,
  createDefaultAnonymousTelemetryPersistedState,
  deriveAnonymousTelemetryDirectives,
  hasAnonymousUsageCounters,
  type AnonymousUsageCounters,
  type AnonymousTelemetryActivationMilestone,
  type AnonymousTelemetryDirective,
  type AnonymousTelemetryRecordType,
  type AnonymousVersionPayload,
} from "@/lib/domain/telemetry/anonymous-events";
import type { DesktopTelemetryMode } from "@/lib/domain/telemetry/mode";
import {
  loadAnonymousTelemetryBootstrap,
  saveAnonymousTelemetryState,
} from "./anonymous-storage";

interface AnonymousTelemetryInitInput {
  endpoint: string;
  telemetryMode: DesktopTelemetryMode;
}

interface AnonymousTelemetryRuntime {
  installId: string;
  appVersion: string;
  platform: string;
  arch: string;
  endpoint: string;
  telemetryMode: DesktopTelemetryMode;
}

const USAGE_FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const VERSION_HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

let runtime: AnonymousTelemetryRuntime | null = null;
let persistedState = createDefaultAnonymousTelemetryPersistedState();
let initialized = false;
let initializing: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let versionTimerId: number | null = null;
let housekeepingTimerId: number | null = null;
let usageFlushPromise: Promise<void> | null = null;
let pendingDirectives: AnonymousTelemetryDirective[] = [];

function logAnonymousTelemetryWarning(message: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(message, error);
  }
}

function persistState(): Promise<void> {
  saveQueue = saveQueue
    .then(() => saveAnonymousTelemetryState(persistedState))
    .catch((error) => {
      logAnonymousTelemetryWarning("Failed to persist anonymous telemetry state", error);
    });
  return saveQueue;
}

function isUsageFlushDue(now: Date): boolean {
  const lastFlushedAt = persistedState.lastUsageFlushedAt
    ? Date.parse(persistedState.lastUsageFlushedAt)
    : Number.NaN;

  if (!Number.isFinite(lastFlushedAt)) {
    return true;
  }

  return now.getTime() - lastFlushedAt >= USAGE_FLUSH_INTERVAL_MS;
}

async function postAnonymousRecord(
  recordType: AnonymousTelemetryRecordType,
  payload:
    | AnonymousVersionPayload
    | { milestone: AnonymousTelemetryActivationMilestone }
    | AnonymousUsageCounters,
): Promise<void> {
  if (!runtime) {
    return;
  }

  const response = await fetch(runtime.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      installUuid: runtime.installId,
      surface: "desktop",
      telemetryMode: runtime.telemetryMode,
      recordType,
      payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`anonymous_telemetry_${recordType.toLowerCase()}_${response.status}`);
  }
}

async function sendVersionRecord(): Promise<void> {
  if (!runtime) {
    return;
  }

  await postAnonymousRecord("VERSION", {
    appVersion: runtime.appVersion,
    platform: runtime.platform,
    arch: runtime.arch,
  });
}

async function sendActivationRecord(
  milestone: AnonymousTelemetryActivationMilestone,
): Promise<void> {
  await postAnonymousRecord("ACTIVATION", {
    milestone,
  });
}

async function flushUsageCounters(): Promise<void> {
  if (!runtime || usageFlushPromise || !hasAnonymousUsageCounters(persistedState.usageCounters)) {
    return;
  }

  const now = new Date();
  if (!isUsageFlushDue(now)) {
    return;
  }

  const snapshot = copyAnonymousUsageCounters(persistedState.usageCounters);
  usageFlushPromise = (async () => {
    try {
      await postAnonymousRecord("USAGE", snapshot);
      for (const key of Object.keys(snapshot) as Array<keyof AnonymousUsageCounters>) {
        persistedState.usageCounters[key] = Math.max(
          0,
          persistedState.usageCounters[key] - snapshot[key],
        );
      }
      persistedState.lastUsageFlushedAt = now.toISOString();
      await persistState();
    } finally {
      usageFlushPromise = null;
    }
  })();

  await usageFlushPromise;
}

async function retryPendingMilestones(): Promise<void> {
  if (!runtime || persistedState.pendingMilestones.length === 0) {
    return;
  }

  for (const milestone of [...persistedState.pendingMilestones]) {
    try {
      await sendActivationRecord(milestone);
      persistedState.pendingMilestones = persistedState.pendingMilestones.filter(
        (value) => value !== milestone,
      );
      if (!persistedState.sentMilestones.includes(milestone)) {
        persistedState.sentMilestones.push(milestone);
      }
      await persistState();
    } catch {
      break;
    }
  }
}

async function markActivation(
  milestone: AnonymousTelemetryActivationMilestone,
): Promise<void> {
  if (!runtime) {
    return;
  }

  if (
    persistedState.sentMilestones.includes(milestone)
    || persistedState.pendingMilestones.includes(milestone)
  ) {
    return;
  }

  persistedState.pendingMilestones = [...persistedState.pendingMilestones, milestone];
  await persistState();

  try {
    await sendActivationRecord(milestone);
    persistedState.pendingMilestones = persistedState.pendingMilestones.filter(
      (value) => value !== milestone,
    );
    persistedState.sentMilestones = [...persistedState.sentMilestones, milestone];
    await persistState();
  } catch {
    // Keep the milestone pending for the next retry cycle.
  }
}

async function applyDirective(
  directive: AnonymousTelemetryDirective,
): Promise<void> {
  if (directive.kind === "increment_usage") {
    persistedState.usageCounters[directive.counter] += 1;
    await persistState();
    return;
  }

  await markActivation(directive.milestone);
}

function startTimers(): void {
  if (versionTimerId !== null || housekeepingTimerId !== null) {
    return;
  }

  versionTimerId = window.setInterval(() => {
    void sendVersionRecord().catch((error) => {
      logAnonymousTelemetryWarning("Failed to send anonymous telemetry version heartbeat", error);
    });
  }, VERSION_HEARTBEAT_INTERVAL_MS);

  housekeepingTimerId = window.setInterval(() => {
    void retryPendingMilestones().catch((error) => {
      logAnonymousTelemetryWarning("Failed to retry pending anonymous milestones", error);
    });
    void flushUsageCounters().catch((error) => {
      logAnonymousTelemetryWarning("Failed to flush anonymous usage counters", error);
    });
  }, HOUSEKEEPING_INTERVAL_MS);
}

export async function initializeAnonymousTelemetry(
  input: AnonymousTelemetryInitInput,
): Promise<void> {
  if (initialized && runtime?.telemetryMode === input.telemetryMode && runtime.endpoint === input.endpoint) {
    return;
  }

  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
    const bootstrap = await loadAnonymousTelemetryBootstrap();
    persistedState = bootstrap.state ?? createDefaultAnonymousTelemetryPersistedState();
    runtime = {
      installId: bootstrap.installId,
      appVersion: bootstrap.appVersion,
      platform: bootstrap.platform,
      arch: bootstrap.arch,
      endpoint: input.endpoint,
      telemetryMode: input.telemetryMode,
    };
    initialized = true;

    await markActivation("first_launch");
    await retryPendingMilestones();

    for (const directive of pendingDirectives) {
      await applyDirective(directive);
    }
    pendingDirectives = [];

    try {
      await sendVersionRecord();
    } catch (error) {
      logAnonymousTelemetryWarning("Failed to send initial anonymous telemetry heartbeat", error);
      // The next timer cycle retries the heartbeat.
    }

    await flushUsageCounters().catch((error) => {
      logAnonymousTelemetryWarning("Failed to flush initial anonymous usage counters", error);
    });
    startTimers();
  })().finally(() => {
    initializing = null;
  });

  return initializing;
}

export function handleAnonymousProductEvent<
  E extends keyof DesktopProductEventMap,
>(
  name: E,
  properties: DesktopProductEventMap[E],
): void {
  const directives = deriveAnonymousTelemetryDirectives(name, properties);
  if (directives.length === 0) {
    return;
  }

  if (!initialized || !runtime) {
    pendingDirectives.push(...directives);
    return;
  }

  for (const directive of directives) {
    void applyDirective(directive);
  }
}
