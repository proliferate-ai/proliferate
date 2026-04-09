export interface ModelRegistryModel {
  id: string;
  displayName: string;
  description?: string | null;
  isDefault: boolean;
}

export interface ModelRegistry {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: ModelRegistryModel[];
}
