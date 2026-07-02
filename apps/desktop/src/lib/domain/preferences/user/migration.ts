import {
  resolveAppearanceSizeId,
  resolveWindowZoomId,
} from "@/lib/domain/preferences/appearance";
import {
  sanitizeReviewDefaultsByKind,
  sanitizeReviewPersonalitiesByKind,
} from "@/lib/domain/preferences/review-preferences";
import {
  normalizeDefaultChatModelId,
  sanitizeChatModelVisibilityOverridesByAgentKind,
  sanitizeDefaultChatModelIdByAgentKind,
  sanitizeDefaultLiveSessionControlValuesByAgentKind,
  sanitizeDefaultSessionModeByAgentKind,
} from "@/lib/domain/preferences/user/session-defaults";
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
  const {
    defaultChatModelId,
    defaultChatModelIdByAgentKind,
    ...preferencesWithoutLegacyModel
  } = preferences;
  const next = {
    ...PERSISTED_RECORD_BACKFILL,
    ...preferencesWithoutLegacyModel,
    defaultChatModelIdByAgentKind: {},
  } as UserPreferences;
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

  if (
    next.defaultNewWorkspaceMode !== "worktree"
    && next.defaultNewWorkspaceMode !== "local"
  ) {
    next.defaultNewWorkspaceMode = PERSISTED_RECORD_BACKFILL.defaultNewWorkspaceMode;
    changed = true;
  }

  const sanitizedDefaultOpenInTargetId = typeof next.defaultOpenInTargetId === "string"
    ? next.defaultOpenInTargetId.trim()
    : "";
  if (sanitizedDefaultOpenInTargetId) {
    if (sanitizedDefaultOpenInTargetId !== next.defaultOpenInTargetId) {
      next.defaultOpenInTargetId = sanitizedDefaultOpenInTargetId;
      changed = true;
    }
  } else {
    next.defaultOpenInTargetId = PERSISTED_RECORD_BACKFILL.defaultOpenInTargetId;
    changed = true;
  }

  if (typeof next.transparentChromeEnabled !== "boolean") {
    next.transparentChromeEnabled = PERSISTED_RECORD_BACKFILL.transparentChromeEnabled;
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

  const windowZoomId = resolveWindowZoomId(next.windowZoomId);
  if (windowZoomId !== next.windowZoomId) {
    next.windowZoomId = windowZoomId;
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

  const migratedDefaultLiveControls = migrateMisstoredCodexCollaborationModeDefault(
    next.defaultSessionModeByAgentKind,
    next.defaultLiveSessionControlValuesByAgentKind,
  );
  if (migratedDefaultLiveControls.changed) {
    next.defaultLiveSessionControlValuesByAgentKind =
      migratedDefaultLiveControls.defaultLiveSessionControlValuesByAgentKind;
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

function migrateMisstoredCodexCollaborationModeDefault(
  defaultSessionModeByAgentKind: unknown,
  defaultLiveSessionControlValuesByAgentKind: unknown,
): {
  defaultLiveSessionControlValuesByAgentKind:
    UserPreferences["defaultLiveSessionControlValuesByAgentKind"];
  changed: boolean;
} {
  const liveDefaults = isPlainRecord(defaultLiveSessionControlValuesByAgentKind)
    ? defaultLiveSessionControlValuesByAgentKind
    : {};
  if (!isPlainRecord(defaultSessionModeByAgentKind)) {
    return {
      defaultLiveSessionControlValuesByAgentKind:
        liveDefaults as UserPreferences["defaultLiveSessionControlValuesByAgentKind"],
      changed: !isPlainRecord(defaultLiveSessionControlValuesByAgentKind),
    };
  }

  const hasCodexPlanMode = Object.entries(defaultSessionModeByAgentKind).some(
    ([agentKind, modeId]) =>
      agentKind.trim() === "codex"
      && typeof modeId === "string"
      && modeId.trim() === "plan",
  );
  if (!hasCodexPlanMode) {
    return {
      defaultLiveSessionControlValuesByAgentKind:
        liveDefaults as UserPreferences["defaultLiveSessionControlValuesByAgentKind"],
      changed: false,
    };
  }

  const codexControls = isPlainRecord(liveDefaults.codex) ? liveDefaults.codex : {};
  if (
    typeof codexControls.collaboration_mode === "string"
    && codexControls.collaboration_mode.trim()
  ) {
    return {
      defaultLiveSessionControlValuesByAgentKind:
        liveDefaults as UserPreferences["defaultLiveSessionControlValuesByAgentKind"],
      changed: false,
    };
  }

  return {
    defaultLiveSessionControlValuesByAgentKind: {
      ...liveDefaults,
      codex: {
        ...codexControls,
        collaboration_mode: "plan",
      },
    } as UserPreferences["defaultLiveSessionControlValuesByAgentKind"],
    changed: true,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
