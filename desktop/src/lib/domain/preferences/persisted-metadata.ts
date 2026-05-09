import type { UserPreferences } from "@/lib/domain/preferences/user/model";

export type PersistedUserPreferencesMetadata = Record<string, unknown>;

export const WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY =
  "worktreeAutoDeleteLimitBackfilled";

export function hasPendingWorktreeAutoDeleteLimitAdoption(
  metadata: PersistedUserPreferencesMetadata,
): boolean {
  return metadata[WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY] === true;
}

export function clearWorktreeAutoDeleteLimitAdoption(
  metadata: PersistedUserPreferencesMetadata,
): PersistedUserPreferencesMetadata {
  if (!hasPendingWorktreeAutoDeleteLimitAdoption(metadata)) {
    return metadata;
  }
  const { [WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY]: _removed, ...next } = metadata;
  return next;
}

export function selectPersistedUserPreferencesSlice(
  preferences: UserPreferences,
): UserPreferences {
  return {
    themePreset: preferences.themePreset,
    colorMode: preferences.colorMode,
    uiFontSizeId: preferences.uiFontSizeId,
    readableCodeFontSizeId: preferences.readableCodeFontSizeId,
    defaultChatAgentKind: preferences.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: preferences.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: preferences.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      preferences.defaultLiveSessionControlValuesByAgentKind,
    defaultOpenInTargetId: preferences.defaultOpenInTargetId,
    branchPrefixType: preferences.branchPrefixType,
    turnEndSoundEnabled: preferences.turnEndSoundEnabled,
    turnEndSoundId: preferences.turnEndSoundId,
    transparentChromeEnabled: preferences.transparentChromeEnabled,
    pluginsInCodingSessionsEnabled: preferences.pluginsInCodingSessionsEnabled,
    subagentsEnabled: preferences.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: preferences.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: preferences.cloudRuntimeInputSyncEnabled,
    worktreeAutoDeleteLimit: preferences.worktreeAutoDeleteLimit,
    pasteAttachmentsEnabled: preferences.pasteAttachmentsEnabled,
    reviewDefaultsByKind: preferences.reviewDefaultsByKind,
    reviewPersonalitiesByKind: preferences.reviewPersonalitiesByKind,
  };
}

export function buildPersistedUserPreferencesRecord(
  preferences: UserPreferences,
  metadata: PersistedUserPreferencesMetadata,
): Record<string, unknown> {
  const {
    worktreeAutoDeleteLimit,
    ...preferencesWithoutWorktreeAutoDeleteLimit
  } = preferences;

  return {
    ...metadata,
    ...(hasPendingWorktreeAutoDeleteLimitAdoption(metadata)
      ? preferencesWithoutWorktreeAutoDeleteLimit
      : { ...preferencesWithoutWorktreeAutoDeleteLimit, worktreeAutoDeleteLimit }),
  };
}
