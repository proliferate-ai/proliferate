import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

const LEGACY_DEFAULT_SIDEBAR_WORKSPACE_TYPES: SidebarWorkspaceVariant[] = [
  "local",
  "worktree",
  "cloud",
];

export function normalizeSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
): SidebarWorkspaceVariant[] {
  const typeSet = new Set<SidebarWorkspaceVariant>(workspaceTypes);
  return DEFAULT_SIDEBAR_WORKSPACE_TYPES.filter((type) => typeSet.has(type));
}

export function resolveSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[] | null | undefined,
): SidebarWorkspaceVariant[] {
  if (isLegacyDefaultSidebarWorkspaceTypes(workspaceTypes ?? [])) {
    return DEFAULT_SIDEBAR_WORKSPACE_TYPES;
  }
  const normalized = normalizeSidebarWorkspaceTypes(workspaceTypes ?? []);
  return normalized.length > 0 ? normalized : DEFAULT_SIDEBAR_WORKSPACE_TYPES;
}

export function isDefaultSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
): boolean {
  return resolveSidebarWorkspaceTypes(workspaceTypes).length === DEFAULT_SIDEBAR_WORKSPACE_TYPES.length;
}

export function toggleSidebarWorkspaceTypeSelection(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
  type: SidebarWorkspaceVariant,
): SidebarWorkspaceVariant[] {
  const normalized = resolveSidebarWorkspaceTypes(workspaceTypes);
  if (normalized.includes(type)) {
    return normalized.length === 1
      ? normalized
      : normalized.filter((selectedType) => selectedType !== type);
  }

  return normalizeSidebarWorkspaceTypes([...normalized, type]);
}

function isLegacyDefaultSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
): boolean {
  if (workspaceTypes.length !== LEGACY_DEFAULT_SIDEBAR_WORKSPACE_TYPES.length) {
    return false;
  }
  const typeSet = new Set(workspaceTypes);
  return LEGACY_DEFAULT_SIDEBAR_WORKSPACE_TYPES.every((type) => typeSet.has(type));
}
