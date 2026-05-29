export type EditorIconId =
  | "cursor"
  | "vscode"
  | "windsurf"
  | "zed"
  | "sublime";

export interface EditorInfo {
  id: string;
  label: string;
  shortcut: string | null;
  iconId: EditorIconId;
}

export type OpenTargetKind = "editor" | "finder" | "terminal" | "copy";
export type OpenTargetIconId = EditorIconId | "finder" | "terminal";
export type PathKind = "directory" | "file";

export interface OpenTarget {
  id: string;
  label: string;
  kind: OpenTargetKind;
  shortcut?: string;
  iconId?: OpenTargetIconId;
}
