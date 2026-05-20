import type { ColorMode, ThemePreset } from "@/config/theme";
import type { ReadableCodeFontSizeId, UiFontSizeId } from "@/lib/domain/preferences/appearance";
import type {
  ChatModelVisibilityOverridesByAgentKind,
  DefaultLiveSessionControlValuesByAgentKind,
} from "@/lib/domain/preferences/user/session-defaults";
import { WORKTREE_AUTO_DELETE_LIMIT_DEFAULT } from "@/lib/domain/preferences/user/worktree-auto-delete";
import type {
  ReviewDefaultsByKind,
  ReviewPersonalitiesByKind,
} from "@/lib/domain/preferences/review-preferences";

export type BranchPrefixType = "none" | "proliferate" | "github_username";
export type TurnEndSoundId = "ding" | "gong";

export interface UserPreferences {
  themePreset: ThemePreset;
  colorMode: ColorMode;
  uiFontSizeId: UiFontSizeId;
  readableCodeFontSizeId: ReadableCodeFontSizeId;
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  chatModelVisibilityOverridesByAgentKind: ChatModelVisibilityOverridesByAgentKind;
  defaultSessionModeByAgentKind: Record<string, string>;
  defaultLiveSessionControlValuesByAgentKind: DefaultLiveSessionControlValuesByAgentKind;
  defaultOpenInTargetId: string;
  branchPrefixType: BranchPrefixType;
  turnEndSoundEnabled: boolean;
  turnEndSoundId: TurnEndSoundId;
  transparentChromeEnabled: boolean;
  pluginsInCodingSessionsEnabled: boolean;
  subagentsEnabled: boolean;
  coworkWorkspaceDelegationEnabled: boolean;
  cloudRuntimeInputSyncEnabled: boolean;
  worktreeAutoDeleteLimit: number;
  pasteAttachmentsEnabled: boolean;
  reviewDefaultsByKind: ReviewDefaultsByKind;
  reviewPersonalitiesByKind: ReviewPersonalitiesByKind;
}

export const NEW_USER_DEFAULTS: UserPreferences = {
  themePreset: "mono",
  colorMode: "dark",
  uiFontSizeId: "default",
  readableCodeFontSizeId: "default",
  defaultChatAgentKind: "claude",
  defaultChatModelIdByAgentKind: {},
  chatModelVisibilityOverridesByAgentKind: {},
  defaultSessionModeByAgentKind: {},
  defaultLiveSessionControlValuesByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  transparentChromeEnabled: false,
  pluginsInCodingSessionsEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  cloudRuntimeInputSyncEnabled: false,
  worktreeAutoDeleteLimit: WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  pasteAttachmentsEnabled: true,
  reviewDefaultsByKind: { plan: null, code: null },
  reviewPersonalitiesByKind: { plan: [], code: [] },
};

export const PERSISTED_RECORD_BACKFILL: UserPreferences = {
  themePreset: "ship",
  colorMode: "dark",
  uiFontSizeId: "default",
  readableCodeFontSizeId: "default",
  defaultChatAgentKind: "",
  defaultChatModelIdByAgentKind: {},
  chatModelVisibilityOverridesByAgentKind: {},
  defaultSessionModeByAgentKind: {},
  defaultLiveSessionControlValuesByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  // Existing persisted records keep the legacy transparent chrome default;
  // only fresh installs use the opaque NEW_USER_DEFAULTS value.
  transparentChromeEnabled: true,
  pluginsInCodingSessionsEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  cloudRuntimeInputSyncEnabled: false,
  worktreeAutoDeleteLimit: WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  pasteAttachmentsEnabled: true,
  reviewDefaultsByKind: { plan: null, code: null },
  reviewPersonalitiesByKind: { plan: [], code: [] },
};

export const USER_PREFERENCE_DEFAULTS = NEW_USER_DEFAULTS;
