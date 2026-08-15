import type { AvailableSessionCommand } from "@anyharness/sdk";
import { create } from "zustand";
import {
  readPersistedJson,
  writePersistedJson,
  type ProductStorageContext,
} from "#product/lib/infra/persistence/product-storage";

export const SLASH_COMMAND_CATALOG_STORAGE_KEY = "proliferate.slashCommandCatalog.v1";

interface SlashCommandCatalogState {
  /**
   * The most recent ACP command catalog each harness kind streamed from any
   * session, persisted across app runs. Surfaces with no live session to ask
   * (the pre-creation home composer, PRO-228) read this as their stand-in for
   * `transcript.availableCommands`.
   */
  catalogsByAgentKind: Record<string, AvailableSessionCommand[]>;
  recordCatalog: (
    agentKind: string,
    commands: readonly AvailableSessionCommand[],
  ) => void;
}

// This store is a module singleton, so it cannot call `useProductHost()`. Its
// persistence backend is injected once at the product lifecycle mount (see
// `useProductStoragePersistenceLifecycle`). Writes before hydration settles
// stay in-memory — persisting the whole record then would clobber the other
// harnesses' persisted catalogs — and are flushed merged once hydration lands.
let storageContext: ProductStorageContext | null = null;
let hydrationSettled = false;
let recordedBeforeHydration = false;

export function setSlashCommandCatalogStorageContext(
  context: ProductStorageContext | null,
): void {
  storageContext = context;
  hydrationSettled = false;
}

export const useSlashCommandCatalogStore = create<SlashCommandCatalogState>((set, get) => ({
  catalogsByAgentKind: {},

  recordCatalog: (agentKind, commands) => {
    const catalog = commands.map(toPersistedCommand);
    const current = get().catalogsByAgentKind[agentKind];
    if (current && catalogsEqual(current, catalog)) {
      return;
    }
    const catalogsByAgentKind = {
      ...get().catalogsByAgentKind,
      [agentKind]: catalog,
    };
    set({ catalogsByAgentKind });
    if (storageContext && hydrationSettled) {
      persistCatalogs(storageContext, catalogsByAgentKind);
    } else {
      recordedBeforeHydration = true;
    }
  },
}));

/**
 * One-shot hydration of the persisted catalogs through the injected
 * ProductStorage. Catalogs a live session already recorded win over the
 * persisted snapshot, and a read that resolves after unmount (`isStale`) is
 * ignored so a late read never overwrites live state.
 */
export async function hydrateSlashCommandCatalog(
  context: ProductStorageContext,
  isStale?: () => boolean,
): Promise<void> {
  const result = await readPersistedJson<Record<string, AvailableSessionCommand[]>>(
    context,
    SLASH_COMMAND_CATALOG_STORAGE_KEY,
    {
      parse: parsePersistedCatalogs,
      fallback: {},
      isStale,
    },
  );
  if (result.status !== "settled") {
    return;
  }
  if (Object.keys(result.value).length > 0) {
    useSlashCommandCatalogStore.setState((state) => ({
      catalogsByAgentKind: { ...result.value, ...state.catalogsByAgentKind },
    }));
  }
  hydrationSettled = true;
  if (recordedBeforeHydration) {
    recordedBeforeHydration = false;
    persistCatalogs(
      context,
      useSlashCommandCatalogStore.getState().catalogsByAgentKind,
    );
  }
}

export function resetSlashCommandCatalogForTests(): void {
  storageContext = null;
  hydrationSettled = false;
  recordedBeforeHydration = false;
  useSlashCommandCatalogStore.setState({ catalogsByAgentKind: {} });
}

function persistCatalogs(
  context: ProductStorageContext,
  catalogsByAgentKind: Record<string, AvailableSessionCommand[]>,
): void {
  void writePersistedJson(context, SLASH_COMMAND_CATALOG_STORAGE_KEY, catalogsByAgentKind);
}

/**
 * Keeps only the fields the desktop slash-command policy reads; ACP's opaque
 * `meta` extension payload stays out of client storage.
 */
function toPersistedCommand(command: AvailableSessionCommand): AvailableSessionCommand {
  return {
    name: command.name,
    description: command.description,
    input: typeof command.input?.hint === "string" ? { hint: command.input.hint } : null,
  };
}

function catalogsEqual(
  a: readonly AvailableSessionCommand[],
  b: readonly AvailableSessionCommand[],
): boolean {
  return a.length === b.length && a.every((command, index) => (
    command.name === b[index]?.name
    && command.description === b[index]?.description
    && (command.input?.hint ?? null) === (b[index]?.input?.hint ?? null)
  ));
}

function parsePersistedCatalogs(raw: unknown): Record<string, AvailableSessionCommand[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const catalogs: Record<string, AvailableSessionCommand[]> = {};
  for (const [agentKind, commands] of Object.entries(raw)) {
    if (!Array.isArray(commands)) {
      continue;
    }
    const parsed = commands.filter(isPersistedCommand).map(toPersistedCommand);
    if (parsed.length > 0) {
      catalogs[agentKind] = parsed;
    }
  }
  return catalogs;
}

function isPersistedCommand(value: unknown): value is AvailableSessionCommand {
  return typeof value === "object"
    && value !== null
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { description?: unknown }).description === "string";
}
