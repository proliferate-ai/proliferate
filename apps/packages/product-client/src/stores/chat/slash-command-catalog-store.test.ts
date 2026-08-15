import { afterEach, describe, expect, it } from "vitest";
import { createMemoryProductStorage } from "#product/test/product-storage-test-utils";
import {
  SLASH_COMMAND_CATALOG_STORAGE_KEY,
  hydrateSlashCommandCatalog,
  resetSlashCommandCatalogForTests,
  setSlashCommandCatalogStorageContext,
  useSlashCommandCatalogStore,
} from "#product/stores/chat/slash-command-catalog-store";

afterEach(() => {
  resetSlashCommandCatalogForTests();
});

const FIX_TICKET = {
  name: "fix-ticket",
  description: "Implement a Linear ticket",
  input: { hint: "ticket id" },
};

describe("slash command catalog store", () => {
  it("records a catalog per agent kind, strips meta, and persists through the context", async () => {
    const memory = createMemoryProductStorage();
    setSlashCommandCatalogStorageContext(memory.context);
    await hydrateSlashCommandCatalog(memory.context);

    useSlashCommandCatalogStore.getState().recordCatalog("claude", [
      { ...FIX_TICKET, meta: { acp: "extension" } },
    ]);
    await Promise.resolve();

    expect(useSlashCommandCatalogStore.getState().catalogsByAgentKind).toEqual({
      claude: [FIX_TICKET],
    });
    expect(memory.readJson(SLASH_COMMAND_CATALOG_STORAGE_KEY)).toEqual({
      claude: [FIX_TICKET],
    });
  });

  it("skips the write when the catalog is unchanged", () => {
    useSlashCommandCatalogStore.getState().recordCatalog("claude", [FIX_TICKET]);
    const first = useSlashCommandCatalogStore.getState().catalogsByAgentKind;

    useSlashCommandCatalogStore.getState().recordCatalog("claude", [{ ...FIX_TICKET }]);

    expect(useSlashCommandCatalogStore.getState().catalogsByAgentKind).toBe(first);
  });

  it("hydrates persisted catalogs without overwriting live entries and flushes the merge", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(SLASH_COMMAND_CATALOG_STORAGE_KEY, {
      claude: [{ name: "stale", description: "persisted before this run" }],
      codex: [{ name: "review", description: "" }],
      malformed: "not-an-array",
    });
    setSlashCommandCatalogStorageContext(memory.context);

    // Recorded before hydration settles: kept in memory only, so the write
    // cannot clobber the other harnesses' persisted catalogs.
    useSlashCommandCatalogStore.getState().recordCatalog("claude", [FIX_TICKET]);
    expect(memory.readJson(SLASH_COMMAND_CATALOG_STORAGE_KEY)).toEqual({
      claude: [{ name: "stale", description: "persisted before this run" }],
      codex: [{ name: "review", description: "" }],
      malformed: "not-an-array",
    });

    await hydrateSlashCommandCatalog(memory.context);
    await Promise.resolve();

    const merged = {
      claude: [FIX_TICKET],
      codex: [{ name: "review", description: "", input: null }],
    };
    expect(useSlashCommandCatalogStore.getState().catalogsByAgentKind).toEqual(merged);
    expect(memory.readJson(SLASH_COMMAND_CATALOG_STORAGE_KEY)).toEqual(merged);
  });

  it("ignores a stale hydration read", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(SLASH_COMMAND_CATALOG_STORAGE_KEY, {
      claude: [FIX_TICKET],
    });
    setSlashCommandCatalogStorageContext(memory.context);

    await hydrateSlashCommandCatalog(memory.context, () => true);

    expect(useSlashCommandCatalogStore.getState().catalogsByAgentKind).toEqual({});
  });
});
