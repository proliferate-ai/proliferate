import type { UserPreferences } from "@/lib/domain/preferences/user/model";

export type PersistedUserPreferencesMetadata = Record<string, unknown>;

export const WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY =
  "worktreeAutoDeleteLimitBackfilled";
export const MODEL_VISIBILITY_DEFAULTS_RESET_KEY =
  "modelVisibilityDefaults20260531Reset";

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

export function hasAppliedModelVisibilityDefaultsReset(
  metadata: PersistedUserPreferencesMetadata,
): boolean {
  return metadata[MODEL_VISIBILITY_DEFAULTS_RESET_KEY] === true;
}

export function markModelVisibilityDefaultsReset(
  metadata: PersistedUserPreferencesMetadata,
): PersistedUserPreferencesMetadata {
  if (hasAppliedModelVisibilityDefaultsReset(metadata)) {
    return metadata;
  }
  return {
    ...metadata,
    [MODEL_VISIBILITY_DEFAULTS_RESET_KEY]: true,
  };
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
    chatModelVisibilityOverridesByAgentKind:
      preferences.chatModelVisibilityOverridesByAgentKind,
    defaultSessionModeByAgentKind: preferences.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      preferences.defaultLiveSessionControlValuesByAgentKind,
    defaultOpenInTargetId: preferences.defaultOpenInTargetId,
    branchPrefixType: preferences.branchPrefixType,
    defaultNewWorkspaceMode: preferences.defaultNewWorkspaceMode,
    turnEndSoundEnabled: preferences.turnEndSoundEnabled,
    turnEndSoundId: preferences.turnEndSoundId,
    transparentChromeEnabled: preferences.transparentChromeEnabled,
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
