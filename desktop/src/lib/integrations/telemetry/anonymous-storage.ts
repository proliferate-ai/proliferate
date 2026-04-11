import {
  ANONYMOUS_TELEMETRY_SCHEMA_VERSION,
  type AnonymousTelemetryPersistedState,
  createDefaultAnonymousTelemetryPersistedState,
} from "@/lib/domain/telemetry/anonymous-events";
import { getAppVersion } from "@/platform/tauri/updater";
import {
  type AnonymousTelemetryBootstrapRecord,
  loadNativeAnonymousTelemetryBootstrap,
  saveNativeAnonymousTelemetryState,
} from "@/platform/tauri/anonymous-telemetry";

const BROWSER_INSTALL_ID_KEY = "proliferate.anonymousTelemetry.installId";
const BROWSER_STATE_KEY = "proliferate.anonymousTelemetry.desktopState";

interface BrowserUserAgentData {
  platform?: string;
  architecture?: string;
}

function isTauriDesktop(): boolean {
  return (
    typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

function browserStorageAvailable(): boolean {
  return typeof window !== "undefined" && "localStorage" in window;
}

function readBrowserState(): AnonymousTelemetryPersistedState {
  if (!browserStorageAvailable()) {
    return createDefaultAnonymousTelemetryPersistedState();
  }

  try {
    const raw = window.localStorage.getItem(BROWSER_STATE_KEY);
    if (!raw) {
      return createDefaultAnonymousTelemetryPersistedState();
    }

    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== ANONYMOUS_TELEMETRY_SCHEMA_VERSION) {
      return createDefaultAnonymousTelemetryPersistedState();
    }
    return {
      ...createDefaultAnonymousTelemetryPersistedState(),
      ...parsed,
      usageCounters: {
        ...createDefaultAnonymousTelemetryPersistedState().usageCounters,
        ...(parsed?.usageCounters ?? {}),
      },
      sentMilestones: Array.isArray(parsed?.sentMilestones) ? parsed.sentMilestones : [],
      pendingMilestones: Array.isArray(parsed?.pendingMilestones) ? parsed.pendingMilestones : [],
      lastUsageFlushedAt:
        typeof parsed?.lastUsageFlushedAt === "string" ? parsed.lastUsageFlushedAt : null,
    };
  } catch {
    return createDefaultAnonymousTelemetryPersistedState();
  }
}

function readBrowserInstallId(): string {
  if (!browserStorageAvailable()) {
    return crypto.randomUUID();
  }

  const existing = window.localStorage.getItem(BROWSER_INSTALL_ID_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const installId = crypto.randomUUID();
  window.localStorage.setItem(BROWSER_INSTALL_ID_KEY, installId);
  return installId;
}

function browserPlatformMetadata(): { platform: string; arch: string } {
  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: BrowserUserAgentData;
  };
  const platform =
    navigatorWithUAData.userAgentData?.platform
    || navigator.platform
    || "unknown";
  const arch = navigatorWithUAData.userAgentData?.architecture || "unknown";

  return {
    platform: platform.trim() || "unknown",
    arch: arch.trim() || "unknown",
  };
}

async function loadBrowserAnonymousTelemetryBootstrap(): Promise<AnonymousTelemetryBootstrapRecord> {
  const { platform, arch } = browserPlatformMetadata();

  return {
    installId: readBrowserInstallId(),
    appVersion: await getAppVersion().catch(() => "0.0.0-dev"),
    platform,
    arch,
    state: readBrowserState(),
  };
}

export async function loadAnonymousTelemetryBootstrap(): Promise<AnonymousTelemetryBootstrapRecord> {
  if (!isTauriDesktop()) {
    return loadBrowserAnonymousTelemetryBootstrap();
  }

  try {
    return await loadNativeAnonymousTelemetryBootstrap();
  } catch {
    return loadBrowserAnonymousTelemetryBootstrap();
  }
}

export async function saveAnonymousTelemetryState(
  state: AnonymousTelemetryPersistedState,
): Promise<void> {
  if (isTauriDesktop()) {
    try {
      await saveNativeAnonymousTelemetryState(state);
      return;
    } catch {
      // Fall through to browser storage fallback when Tauri persistence fails.
    }
  }

  if (!browserStorageAvailable()) {
    return;
  }

  window.localStorage.setItem(BROWSER_STATE_KEY, JSON.stringify(state));
}
