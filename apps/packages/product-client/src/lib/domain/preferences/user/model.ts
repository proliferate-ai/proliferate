import type { ColorMode } from "#product/config/theme";
import type {
  ReadableCodeFontSizeId,
  UiFontSizeId,
  WindowZoomId,
} from "#product/lib/domain/preferences/appearance";
import type {
  DefaultLiveSessionControlValuesByAgentKind,
} from "#product/lib/domain/preferences/user/session-defaults";
import { WORKTREE_AUTO_DELETE_LIMIT_DEFAULT } from "#product/lib/domain/preferences/user/worktree-auto-delete";
import type {
  ReviewDefaultsByKind,
  ReviewPersonalitiesByKind,
} from "#product/lib/domain/preferences/review-preferences";
import { DEFAULT_OPEN_IN_TARGET_ID } from "#product/config/open-target-defaults";
import type { ReleaseTitle } from "#product/lib/domain/updates/release-notice";

export type BranchPrefixType = "none" | "proliferate" | "github_username";
export type TurnEndSoundId = "ding";
export type DefaultNewWorkspaceMode = "worktree" | "local";

/**
 * The app ships a single Mono theme. The persisted key survives (pinned to
 * "mono") so migration can silently flip records saved by older builds that
 * still offered ship/tbpn/original.
 */
export type ThemePreset = "mono";

export interface UserPreferences {
  themePreset: ThemePreset;
  colorMode: ColorMode;
  uiFontSizeId: UiFontSizeId;
  readableCodeFontSizeId: ReadableCodeFontSizeId;
  windowZoomId: WindowZoomId;
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  defaultLiveSessionControlValuesByAgentKind: DefaultLiveSessionControlValuesByAgentKind;
  defaultOpenInTargetId: string;
  branchPrefixType: BranchPrefixType;
  defaultNewWorkspaceMode: DefaultNewWorkspaceMode;
  turnEndSoundEnabled: boolean;
  turnEndSoundId: TurnEndSoundId;
  transparentChromeEnabled: boolean;
  subagentsEnabled: boolean;
  coworkWorkspaceDelegationEnabled: boolean;
  worktreeAutoDeleteLimit: number;
  pasteAttachmentsEnabled: boolean;
  /**
   * System-wide: when true, archiving a workspace also deletes its branch.
   * Client host storage only, no cloud round-trip.
   */
  deleteBranchOnArchive: boolean;
  /**
   * Keep Proliferate up to date: when on (the default), an available update
   * downloads on its own and the sidebar update button is the only surface
   * until it is ready. When off, the `available` phase surfaces a toast asking
   * for the click, because then a click is genuinely required.
   */
  autoUpdateEnabled: boolean;
  reviewDefaultsByKind: ReviewDefaultsByKind;
  reviewPersonalitiesByKind: ReviewPersonalitiesByKind;
  acknowledgedReleaseVersion: string | null;
  cachedInstalledRelease: ReleaseTitle | null;
}

export const NEW_USER_DEFAULTS: UserPreferences = {
  themePreset: "mono",
  colorMode: "dark",
  uiFontSizeId: "default",
  readableCodeFontSizeId: "default",
  windowZoomId: "default",
  defaultChatAgentKind: "claude",
  defaultChatModelIdByAgentKind: {},
  defaultLiveSessionControlValuesByAgentKind: {},
  defaultOpenInTargetId: DEFAULT_OPEN_IN_TARGET_ID,
  branchPrefixType: "none",
  defaultNewWorkspaceMode: "worktree",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  transparentChromeEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  worktreeAutoDeleteLimit: WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  pasteAttachmentsEnabled: true,
  deleteBranchOnArchive: false,
  autoUpdateEnabled: true,
  reviewDefaultsByKind: { plan: null, code: null },
  reviewPersonalitiesByKind: { plan: [], code: [] },
  acknowledgedReleaseVersion: null,
  cachedInstalledRelease: null,
};

export const PERSISTED_RECORD_BACKFILL: UserPreferences = {
  themePreset: "mono",
  colorMode: "dark",
  uiFontSizeId: "default",
  readableCodeFontSizeId: "default",
  windowZoomId: "default",
  defaultChatAgentKind: "",
  defaultChatModelIdByAgentKind: {},
  defaultLiveSessionControlValuesByAgentKind: {},
  defaultOpenInTargetId: DEFAULT_OPEN_IN_TARGET_ID,
  branchPrefixType: "none",
  defaultNewWorkspaceMode: "worktree",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  // Existing persisted records keep the legacy transparent chrome default;
  // only fresh installs use the opaque NEW_USER_DEFAULTS value.
  transparentChromeEnabled: true,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  worktreeAutoDeleteLimit: WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  pasteAttachmentsEnabled: true,
  deleteBranchOnArchive: false,
  autoUpdateEnabled: true,
  reviewDefaultsByKind: { plan: null, code: null },
  reviewPersonalitiesByKind: { plan: [], code: [] },
  acknowledgedReleaseVersion: null,
  cachedInstalledRelease: null,
};

export const USER_PREFERENCE_DEFAULTS = NEW_USER_DEFAULTS;
