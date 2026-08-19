import { invoke } from "@tauri-apps/api/core";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import type {
  EditorInfo,
  OpenTarget,
  PathKind,
} from "@proliferate/product-client/internal/lib/domain/open-targets/model";
import type {
  DesktopPathInspection,
  DesktopPathInspectionUnavailableReason,
} from "@proliferate/product-client/host/desktop-bridge";

export type {
  EditorIconId,
  EditorInfo,
  OpenTarget,
  OpenTargetIconId,
  OpenTargetKind,
  PathKind,
} from "@proliferate/product-client/internal/lib/domain/open-targets/model";

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

const INSPECT_PATH_PROTOCOL_ERROR = "Invalid inspect_path response.";
const INSPECTION_UNAVAILABLE_REASONS = new Set<DesktopPathInspectionUnavailableReason>([
  "invalid_path",
  "permission_denied",
  "unsupported_type",
  "io_error",
]);

export async function inspectPath(path: string): Promise<DesktopPathInspection> {
  const payload = await invoke<unknown>("inspect_path", { path });
  if (!isDesktopPathInspection(payload)) {
    throw new Error(INSPECT_PATH_PROTOCOL_ERROR);
  }
  return payload;
}

function isDesktopPathInspection(value: unknown): value is DesktopPathInspection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    (record.kind === "file" || record.kind === "directory" || record.kind === "missing")
    && keys.length === 1
    && keys[0] === "kind"
  ) {
    return true;
  }
  return record.kind === "unavailable"
    && keys.length === 2
    && keys.includes("kind")
    && keys.includes("reason")
    && typeof record.reason === "string"
    && INSPECTION_UNAVAILABLE_REASONS.has(
      record.reason as DesktopPathInspectionUnavailableReason,
    );
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
  return invoke<string | null>("pick_folder");
}

function isTauriDesktop(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export async function copyText(value: string): Promise<void> {
  if (isTauriDesktop()) {
    await invoke("copy_text", { value });
    return;
  }

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
  _cachedHome = await tauriHomeDir();
  return _cachedHome;
}
