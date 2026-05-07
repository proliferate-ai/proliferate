import { useMemo } from "react";
import {
  copyPath,
  copyText,
  getHomeDir,
  listAvailableEditors,
  listOpenTargets,
  openEmailCompose,
  openExternal,
  openGmailCompose,
  openInEditor,
  openInTerminal,
  openOutlookCompose,
  openTarget,
  pickFolder,
  revealInFinder,
} from "@/lib/access/tauri/shell";
import type {
  EditorInfo,
  EmailComposeInput,
  OpenTarget,
  OpenTargetIconId,
  PathKind,
} from "@/lib/access/tauri/shell";

export type {
  EditorInfo,
  EmailComposeInput,
  OpenTarget,
  OpenTargetIconId,
  PathKind,
};

export function useTauriShellActions() {
  return useMemo(() => ({
    copyPath,
    copyText,
    getHomeDir,
    listAvailableEditors,
    listOpenTargets,
    openEmailCompose,
    openExternal,
    openGmailCompose,
    openInEditor,
    openInTerminal,
    openOutlookCompose,
    openTarget,
    pickFolder,
    revealInFinder,
  }), []);
}
