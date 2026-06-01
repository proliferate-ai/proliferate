import {
  catalogEntryView,
  isActiveCatalogEntry,
} from "./cloud-plugin-catalog";
import {
  availableItem,
  groupSkillsByPluginId,
  installedItem,
  matchesInventoryQuery,
  normalizeQuery,
} from "./cloud-plugin-inventory-items";
import type {
  BuildCloudPluginInventoryInput,
  PluginInventoryItem,
} from "./cloud-plugin-inventory-types";

export * from "./cloud-plugin-inventory-types";
export * from "./cloud-plugin-settings";
export * from "./cloud-plugin-catalog";
export * from "./cloud-plugin-inventory-items";

export function buildCloudPluginInventory({
  catalog,
  connections,
  configuredPlugins,
  configuredSkills,
  surface,
  query,
}: BuildCloudPluginInventoryInput): PluginInventoryItem[] {
  const normalizedQuery = normalizeQuery(query);
  const packagesByCatalogEntryId = new Map(
    (catalog.pluginPackages ?? []).map((pluginPackage) => [
      pluginPackage.catalogEntryId,
      pluginPackage,
    ]),
  );
  const entries = catalog.entries
    .map((entry) => catalogEntryView(entry, packagesByCatalogEntryId.get(entry.id)))
    .filter(isActiveCatalogEntry);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const pluginsByPluginId = new Map(configuredPlugins.map((item) => [item.pluginId, item]));
  const skillsByPluginId = groupSkillsByPluginId(configuredSkills);
  const installed = connections
    .map((connection) => {
      const entry = entriesById.get(connection.catalogEntryId);
      if (!entry) {
        return null;
      }
      return installedItem({
        connection,
        entry,
        configuredPlugin: entry.pluginPackage
          ? pluginsByPluginId.get(entry.pluginPackage.id) ?? null
          : null,
        configuredSkills: entry.pluginPackage
          ? skillsByPluginId.get(entry.pluginPackage.id) ?? []
          : [],
        surface,
      });
    })
    .filter((item): item is PluginInventoryItem => item !== null);
  const installedCatalogEntryIds = new Set(installed.map((item) => item.entry.id));
  const available = entries
    .filter((entry) => !installedCatalogEntryIds.has(entry.id))
    .map((entry) => availableItem(entry, surface));

  return [...installed, ...available].filter((item) =>
    matchesInventoryQuery(item, normalizedQuery)
  );
}
