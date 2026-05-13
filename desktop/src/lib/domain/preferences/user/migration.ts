import { resolveAppearanceSizeId } from "@/lib/domain/preferences/appearance";
import {
  sanitizeReviewDefaultsByKind,
  sanitizeReviewPersonalitiesByKind,
} from "@/lib/domain/preferences/review-preferences";
import {
  normalizeDefaultChatModelId,
  sanitizeDefaultChatModelIdByAgentKind,
  sanitizeDefaultLiveSessionControlValuesByAgentKind,
  sanitizeDefaultSessionModeByAgentKind,
} from "@/lib/domain/preferences/user/session-defaults";
import {
  sanitizeChatModelVisibilityOverridesByAgentKind,
} from "@/lib/domain/chat/models/model-visibility";
import {
  PERSISTED_RECORD_BACKFILL,
  type UserPreferences,
} from "@/lib/domain/preferences/user/model";
import { isValidWorktreeAutoDeleteLimit } from "@/lib/domain/preferences/user/worktree-auto-delete";
import type { LegacyUserPreferencesInput } from "@/lib/domain/preferences/user/persisted-keys";

export function migrateUserPreferences(preferences: LegacyUserPreferencesInput): {
  preferences: UserPreferences;
  changed: boolean;
} {
  const rawPreferences = preferences;
  const legacyPowersPreference = rawPreferences.powersInCodingSessionsEnabled;
  const hasCurrentPluginsPreference =
    typeof rawPreferences.pluginsInCodingSessionsEnabled === "boolean";
  const hasLegacyPowersPreference =
    typeof legacyPowersPreference === "boolean";
  const {
    defaultChatModelId,
    defaultChatModelIdByAgentKind,
    ...preferencesWithoutLegacyModel
  } = preferences;
  const next = {
    ...PERSISTED_RECORD_BACKFILL,
    ...preferencesWithoutLegacyModel,
    defaultChatModelIdByAgentKind: {},
  } as UserPreferences & { powersInCodingSessionsEnabled?: unknown };
  let changed = false;

  const sanitizedDefaultChatAgentKind = typeof next.defaultChatAgentKind === "string"
    ? next.defaultChatAgentKind.trim()
    : PERSISTED_RECORD_BACKFILL.defaultChatAgentKind;
  if (sanitizedDefaultChatAgentKind !== next.defaultChatAgentKind) {
    next.defaultChatAgentKind = sanitizedDefaultChatAgentKind;
    changed = true;
  }

  const sanitizedDefaultChatModelIdByAgentKind = sanitizeDefaultChatModelIdByAgentKind(
    defaultChatModelIdByAgentKind,
  );
  if (
    defaultChatModelIdByAgentKind === undefined
    || JSON.stringify(sanitizedDefaultChatModelIdByAgentKind)
      !== JSON.stringify(defaultChatModelIdByAgentKind)
  ) {
    changed = true;
  }
  next.defaultChatModelIdByAgentKind = sanitizedDefaultChatModelIdByAgentKind;

  const sanitizedChatModelVisibilityOverridesByAgentKind =
    sanitizeChatModelVisibilityOverridesByAgentKind(
      next.chatModelVisibilityOverridesByAgentKind,
    );
  if (
    JSON.stringify(sanitizedChatModelVisibilityOverridesByAgentKind)
    !== JSON.stringify(next.chatModelVisibilityOverridesByAgentKind)
  ) {
    next.chatModelVisibilityOverridesByAgentKind =
      sanitizedChatModelVisibilityOverridesByAgentKind;
    changed = true;
  }

  if (defaultChatModelId !== undefined) {
    changed = true;
    const legacyModelId = typeof defaultChatModelId === "string"
      ? defaultChatModelId.trim()
      : "";
    if (
      next.defaultChatAgentKind
      && legacyModelId
      && !next.defaultChatModelIdByAgentKind[next.defaultChatAgentKind]
    ) {
      next.defaultChatModelIdByAgentKind = {
        ...next.defaultChatModelIdByAgentKind,
        [next.defaultChatAgentKind]: normalizeDefaultChatModelId(
          next.defaultChatAgentKind,
          legacyModelId,
        ),
      };
    }
  }

  if (
    next.branchPrefixType !== "none"
    && next.branchPrefixType !== "proliferate"
    && next.branchPrefixType !== "github_username"
  ) {
    next.branchPrefixType = PERSISTED_RECORD_BACKFILL.branchPrefixType;
    changed = true;
  }

  if (typeof next.transparentChromeEnabled !== "boolean") {
    next.transparentChromeEnabled = PERSISTED_RECORD_BACKFILL.transparentChromeEnabled;
    changed = true;
  }

  if (!hasCurrentPluginsPreference) {
    // "Powers" was the old product name. Read the legacy persisted key once,
    // then write future records with the current "plugins" store field.
    next.pluginsInCodingSessionsEnabled =
      hasLegacyPowersPreference
        ? legacyPowersPreference
        : PERSISTED_RECORD_BACKFILL.pluginsInCodingSessionsEnabled;
    changed = true;
  }
  if ("powersInCodingSessionsEnabled" in rawPreferences) {
    delete next.powersInCodingSessionsEnabled;
    changed = true;
  }

  if (typeof next.subagentsEnabled !== "boolean") {
    next.subagentsEnabled = PERSISTED_RECORD_BACKFILL.subagentsEnabled;
    changed = true;
  }

  if (typeof next.coworkWorkspaceDelegationEnabled !== "boolean") {
    next.coworkWorkspaceDelegationEnabled = PERSISTED_RECORD_BACKFILL.coworkWorkspaceDelegationEnabled;
    changed = true;
  }

  if (typeof next.cloudRuntimeInputSyncEnabled !== "boolean") {
    next.cloudRuntimeInputSyncEnabled = PERSISTED_RECORD_BACKFILL.cloudRuntimeInputSyncEnabled;
    changed = true;
  }

  if (!isValidWorktreeAutoDeleteLimit(next.worktreeAutoDeleteLimit)) {
    next.worktreeAutoDeleteLimit = PERSISTED_RECORD_BACKFILL.worktreeAutoDeleteLimit;
    changed = true;
  }

  if (typeof next.pasteAttachmentsEnabled !== "boolean") {
    next.pasteAttachmentsEnabled = PERSISTED_RECORD_BACKFILL.pasteAttachmentsEnabled;
    changed = true;
  }

  const uiFontSizeId = resolveAppearanceSizeId(next.uiFontSizeId);
  if (uiFontSizeId !== next.uiFontSizeId) {
    next.uiFontSizeId = uiFontSizeId;
    changed = true;
  }

  const readableCodeFontSizeId = resolveAppearanceSizeId(next.readableCodeFontSizeId);
  if (readableCodeFontSizeId !== next.readableCodeFontSizeId) {
    next.readableCodeFontSizeId = readableCodeFontSizeId;
    changed = true;
  }

  const sanitizedReviewDefaultsByKind = sanitizeReviewDefaultsByKind(next.reviewDefaultsByKind);
  if (JSON.stringify(sanitizedReviewDefaultsByKind) !== JSON.stringify(next.reviewDefaultsByKind)) {
    next.reviewDefaultsByKind = sanitizedReviewDefaultsByKind;
    changed = true;
  }

  const sanitizedReviewPersonalitiesByKind = sanitizeReviewPersonalitiesByKind(
    next.reviewPersonalitiesByKind,
  );
  if (
    JSON.stringify(sanitizedReviewPersonalitiesByKind)
    !== JSON.stringify(next.reviewPersonalitiesByKind)
  ) {
    next.reviewPersonalitiesByKind = sanitizedReviewPersonalitiesByKind;
    changed = true;
  }

  const sanitizedDefaultSessionModeByAgentKind = sanitizeDefaultSessionModeByAgentKind(
    next.defaultSessionModeByAgentKind,
  );
  if (
    JSON.stringify(sanitizedDefaultSessionModeByAgentKind)
    !== JSON.stringify(next.defaultSessionModeByAgentKind)
  ) {
    next.defaultSessionModeByAgentKind = sanitizedDefaultSessionModeByAgentKind;
    changed = true;
  }

  const sanitizedDefaultLiveSessionControlValuesByAgentKind =
    sanitizeDefaultLiveSessionControlValuesByAgentKind(
      next.defaultLiveSessionControlValuesByAgentKind,
    );
  if (
    JSON.stringify(sanitizedDefaultLiveSessionControlValuesByAgentKind)
    !== JSON.stringify(next.defaultLiveSessionControlValuesByAgentKind)
  ) {
    next.defaultLiveSessionControlValuesByAgentKind =
      sanitizedDefaultLiveSessionControlValuesByAgentKind;
    changed = true;
  }

  return { preferences: next, changed };
}
