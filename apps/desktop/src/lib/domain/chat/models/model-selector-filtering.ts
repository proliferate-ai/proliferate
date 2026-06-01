import type { ModelSelectorGroup } from "@/lib/domain/chat/models/model-selector-types";

export function filterModelSelectorGroups(
  groups: ModelSelectorGroup[],
  query: string,
): ModelSelectorGroup[] {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        model.displayName.toLowerCase().includes(trimmedQuery)
        || model.modelId.toLowerCase().includes(trimmedQuery)
        || group.providerDisplayName.toLowerCase().includes(trimmedQuery),
      ),
    }))
    .filter((group) => group.models.length > 0);
}

export function filterComposerModelGroups(
  groups: ModelSelectorGroup[],
  query: string,
): ModelSelectorGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return groups;
  }

  return groups.flatMap((group) => {
    const providerMatches = group.providerDisplayName.toLowerCase().includes(normalizedQuery);
    const models = providerMatches
      ? group.models
      : group.models.filter((model) => model.displayName.toLowerCase().includes(normalizedQuery));
    return models.length > 0 ? [{ ...group, models }] : [];
  });
}
