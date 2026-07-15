export const SETTINGS_SCAFFOLD_PAGE_IDS = [] as const;

export type SettingsScaffoldPageId = (typeof SETTINGS_SCAFFOLD_PAGE_IDS)[number];

export interface SettingsScaffoldRowCopy {
  label: string;
  description: string;
}

export interface SettingsScaffoldPageCopy {
  title: string;
  description: string;
  rows: SettingsScaffoldRowCopy[];
}

export const SETTINGS_SCAFFOLD_COPY: Record<SettingsScaffoldPageId, SettingsScaffoldPageCopy> = {} as const;

export function isSettingsScaffoldPageId(value: string): value is SettingsScaffoldPageId {
  return SETTINGS_SCAFFOLD_PAGE_IDS.some((pageId) => pageId === value);
}
