export type ModelCatalogStatus = "candidate" | "active" | "deprecated" | "hidden";

export interface ModelRegistryModel {
  id: string;
  displayName: string;
  description?: string | null;
  isDefault: boolean;
  status?: ModelCatalogStatus;
  aliases?: string[];
  minRuntimeVersion?: string | null;
}

export interface ModelRegistry {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: ModelRegistryModel[];
}
