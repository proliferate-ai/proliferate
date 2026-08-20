import type { UserPreferences } from "#product/lib/domain/preferences/user/model";

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
    windowZoomId: preferences.windowZoomId,
    defaultChatAgentKind: preferences.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: preferences.defaultChatModelIdByAgentKind,
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
    worktreeAutoDeleteLimit: preferences.worktreeAutoDeleteLimit,
    pasteAttachmentsEnabled: preferences.pasteAttachmentsEnabled,
    deleteBranchOnArchive: preferences.deleteBranchOnArchive,
    autoUpdateEnabled: preferences.autoUpdateEnabled,
    reviewDefaultsByKind: preferences.reviewDefaultsByKind,
    reviewPersonalitiesByKind: preferences.reviewPersonalitiesByKind,
    acknowledgedReleaseVersion: preferences.acknowledgedReleaseVersion,
    cachedInstalledRelease: preferences.cachedInstalledRelease,
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
