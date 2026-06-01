import { APP_SHORTCUTS } from "./app-shortcuts";
import { WORKSPACE_SHORTCUTS } from "./workspace-shortcuts";
import type { ShortcutDef } from "./types";

export const SHORTCUTS = {
  ...APP_SHORTCUTS,
  ...WORKSPACE_SHORTCUTS,
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = (typeof SHORTCUTS)[keyof typeof SHORTCUTS]["id"];
export type ShortcutKey = keyof typeof SHORTCUTS;
