import { invoke } from "@tauri-apps/api/core";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";

// ---------------------------------------------------------------------------
// Types returned by Rust
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Normalized UI-facing model
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Low-level wrappers (1:1 with Rust commands)
// ---------------------------------------------------------------------------

export async function listAvailableEditors(): Promise<EditorInfo[]> {
  return invoke<EditorInfo[]>("list_available_editors");
}

export async function openInEditor(
  path: string,
  editorId: string,
): Promise<void> {
  return invoke("open_in_editor", { path, editor: editorId });
}

export async function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

export async function openInTerminal(path: string): Promise<void> {
  return invoke("open_in_terminal", { path });
}

export async function openExternal(url: string): Promise<void> {
  return invoke("open_external", { url });
}

export interface EmailComposeInput {
  to: string;
  subject?: string;
  body?: string;
}

export async function openEmailCompose(input: EmailComposeInput): Promise<void> {
  const to = input.to.trim();
  const params = new URLSearchParams();
  if (input.subject?.trim()) {
    params.set("subject", input.subject.trim());
  }
  if (input.body?.trim()) {
    params.set("body", input.body);
  }

  const query = params.toString();
  const url = `mailto:${to}${query ? `?${query}` : ""}`;
  return openExternal(url);
}

export async function openGmailCompose(input: EmailComposeInput): Promise<void> {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: input.to.trim(),
  });
  if (input.subject?.trim()) {
    params.set("su", input.subject.trim());
  }
  if (input.body?.trim()) {
    params.set("body", input.body);
  }

  return openExternal(`https://mail.google.com/mail/?${params.toString()}`);
}

export async function openOutlookCompose(input: EmailComposeInput): Promise<void> {
  const params = new URLSearchParams({
    to: input.to.trim(),
  });
  if (input.subject?.trim()) {
    params.set("subject", input.subject.trim());
  }
  if (input.body?.trim()) {
    params.set("body", input.body);
  }

  return openExternal(`https://outlook.office.com/mail/deeplink/compose?${params.toString()}`);
}

export async function pickFolder(): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_folder");
  } catch {
    return null;
  }
}

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export async function copyPath(path: string): Promise<void> {
  await copyText(path);
}

// ---------------------------------------------------------------------------
// High-level composed helpers
// ---------------------------------------------------------------------------

export async function listOpenTargets(
  _pathKind?: PathKind,
): Promise<OpenTarget[]> {
  const targets: OpenTarget[] = [];

  targets.push({
    id: "finder",
    label: "Finder",
    kind: "finder",
    iconId: "finder",
  });

  const editors = await listAvailableEditors().catch(() => []);
  for (const editor of editors) {
    targets.push({
      id: editor.id,
      label: editor.label,
      kind: "editor",
      shortcut: editor.shortcut ?? undefined,
      iconId: editor.iconId,
    });
  }

  targets.push({
    id: "terminal",
    label: "Terminal",
    kind: "terminal",
    iconId: "terminal",
  });

  targets.push({
    id: "copy-path",
    label: "Copy path",
    kind: "copy",
    shortcut: "\u2318\u21e7C",
  });

  return targets;
}

export async function openTarget(
  targetId: string,
  path: string,
): Promise<void> {
  switch (targetId) {
    case "finder":
      return revealInFinder(path);
    case "terminal":
      return openInTerminal(path);
    case "copy-path":
      return copyPath(path);
    default:
      return openInEditor(path, targetId);
  }
}

// ---------------------------------------------------------------------------
// Home directory
// ---------------------------------------------------------------------------

let _cachedHome: string | null = null;

export async function getHomeDir(): Promise<string> {
  if (_cachedHome) return _cachedHome;
  try {
    _cachedHome = await tauriHomeDir();
    return _cachedHome;
  } catch {
    // Fallback outside Tauri (dev browser)
    return "/tmp";
  }
}
