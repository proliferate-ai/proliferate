import type { AnyHarnessClientConnection } from "@anyharness/sdk-react";

/**
 * The typed Desktop bridge: product-level native capabilities grouped by
 * concern. It never exposes generic Tauri `invoke`, raw command names, generic
 * filesystem/process access, cloud CRUD, product authentication, product
 * routing, the embedded browser, or repo/git/worktree/chat/session operations
 * (those flow through AnyHarness). Methods are added only when a migrated
 * product consumer actually needs them.
 *
 * This package defines the shared contract; the Desktop adapter is implemented
 * in a later PR. Types here mirror the concrete shapes Desktop already uses so
 * migrated product code keeps its behavior.
 */
export interface DesktopBridge {
  runtime: DesktopRuntimeBridge;
  files: DesktopFilesBridge;
  localCredentials: DesktopCredentialsBridge;
  nativeUi: DesktopNativeUiBridge;
  updater: DesktopUpdaterBridge;
  worker: DesktopWorkerBridge;
  ssh: DesktopSshBridge;
  scratch: DesktopScratchBridge;
  diagnostics: DesktopDiagnosticsBridge;
}

/**
 * A connection to an AnyHarness runtime at the runtime level — base URL plus an
 * optional auth token, with no workspace identity. Runtime discovery and SSH
 * tunnels resolve before any workspace is selected, so this reuses the SDK's
 * client-connection type (what `getAnyHarnessClient` consumes) rather than the
 * workspace-scoped resolved-connection type.
 */
export type LocalRuntimeConnection = AnyHarnessClientConnection;

export interface DesktopRuntimeBridge {
  getConnection(): Promise<LocalRuntimeConnection>;
  restart(): Promise<LocalRuntimeConnection>;
}

// --- Local files and repositories -----------------------------------------

export type EditorIconId = "cursor" | "vscode" | "windsurf" | "zed" | "sublime";
export type PathKind = "directory" | "file";
export type OpenTargetKind = "editor" | "finder" | "terminal" | "copy";
export type OpenTargetIconId = EditorIconId | "finder" | "terminal";

export interface EditorInfo {
  id: string;
  label: string;
  shortcut: string | null;
  iconId: EditorIconId;
}

/** A local open destination. Mirrors Desktop's open-target model, including the
 * copy-path action, icon id, and keyboard shortcut. */
export interface OpenTarget {
  id: string;
  label: string;
  kind: OpenTargetKind;
  shortcut?: string;
  iconId?: OpenTargetIconId;
}

/**
 * Local filesystem and OS access only. Repo inspection, git, worktree, and
 * workspace behavior continue through AnyHarness.
 */
export interface DesktopFilesBridge {
  pickDirectory(): Promise<string | null>;
  getHomeDirectory(): Promise<string>;
  isDirectory(path: string): Promise<boolean>;

  listAvailableEditors(): Promise<EditorInfo[]>;
  listOpenTargets(pathKind?: PathKind): Promise<OpenTarget[]>;
  openTarget(targetId: string, path: string): Promise<void>;

  reveal(path: string): Promise<void>;
  openTerminal(path: string): Promise<void>;
}

// --- Local agent credentials ------------------------------------------------

/**
 * Local model/provider credentials (not Proliferate login credentials — those
 * remain owned by `host.auth`).
 */
export interface DesktopCredentialsBridge {
  listConfigured(): Promise<string[]>;
  set(name: string, secret: string): Promise<void>;
  remove(name: string): Promise<void>;
}

// --- Native UI --------------------------------------------------------------

export type NativeMenuNativeIcon =
  | "copy"
  | "document"
  | "finder"
  | "open"
  | "terminal";

export type NativeMenuIcon =
  | { kind: "asset"; src: string }
  | { kind: "resource"; path: string }
  | { kind: "native"; name: NativeMenuNativeIcon };

/**
 * A native menu item. Mirrors Desktop's context-menu model so the shared
 * product can express separators, nested submenus, per-item icons and
 * accelerators, and selection callbacks — the same content a Web DOM-menu
 * fallback renders (with native-only actions omitted).
 */
export type NativeMenuItem =
  | { kind: "separator" }
  | {
      kind: "submenu";
      submenuId?: string;
      label: string;
      enabled?: boolean;
      items: NativeMenuItem[];
    }
  | {
      kind?: "action";
      id: string;
      label: string;
      accelerator?: string;
      enabled?: boolean;
      icon?: NativeMenuIcon;
      onSelect?: () => void;
    };

export interface MenuPosition {
  x: number;
  y: number;
}

/** A product-level command id dispatched from a native menu/shortcut. */
export type ProductCommand = string;

export type WorkspaceActivityState = "idle" | "attention";

/** Dock/attention indicator payload. Carries the attention count so the badge
 * matches Desktop's current behavior. */
export interface WorkspaceActivityPayload {
  state: WorkspaceActivityState;
  attentionCount: number;
}

/**
 * The shared product owns menu content and native-state intents; Desktop owns
 * the native menu, Dock, and WebView implementation. `showContextMenu` resolves
 * to whether a native menu was shown (so callers can fall back to a DOM menu).
 */
export interface DesktopNativeUiBridge {
  showContextMenu(items: NativeMenuItem[], position?: MenuPosition): Promise<boolean>;
  subscribeMenuCommands(listener: (command: ProductCommand) => void): () => void;

  setRunningAgentCount(count: number): Promise<void>;
  setWorkspaceActivity(payload: WorkspaceActivityPayload): Promise<void>;
  setZoom(scale: number): Promise<void>;
}

// --- Updater ----------------------------------------------------------------

/**
 * An available desktop update. `handle` is the opaque native update handle
 * returned by the check; ProductClient passes it back to
 * `downloadAndInstall` without inspecting it. Native handles stay private to
 * the Desktop implementation.
 */
export interface DesktopUpdate {
  version: string;
  title: string | null;
  handle: unknown;
}

export interface DesktopUpdaterBridge {
  /** False in unpackaged Desktop builds unless the development updater is active. */
  isSupported(): boolean;
  getVersion(): Promise<string>;
  check(): Promise<DesktopUpdate | null>;
  /** `onProgress` receives download completion as a 0..1 fraction. */
  downloadAndInstall(
    update: DesktopUpdate,
    onProgress?: (fraction: number) => void,
  ): Promise<void>;
  relaunch(): Promise<void>;
}

// --- Desktop worker ---------------------------------------------------------

export interface WorkerConfiguration {
  targetId: string;
  enrollmentToken?: string | null;
}

export interface WorkerStatus {
  targetId: string;
  status: "running" | "started";
  configPath: string;
}

/**
 * The product can coordinate and display the worker; Desktop owns the native
 * child process.
 */
export interface DesktopWorkerBridge {
  getInstallId(): Promise<string>;
  ensure(input: WorkerConfiguration): Promise<WorkerStatus>;
  stop(): Promise<void>;
}

// --- SSH --------------------------------------------------------------------

/** A persisted SSH direct-target profile. Mirrors Desktop's stored profile. */
export interface SshProfile {
  targetId: string;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  identityFile?: string | null;
  remoteAnyHarnessPort: number;
  workspaceRoot?: string | null;
}

/**
 * Desktop owns the SSH process and tunnel; once ProductClient receives the
 * local tunnel connection it uses the normal AnyHarness SDK. Only currently
 * needed operations are exposed.
 */
export interface DesktopSshBridge {
  getProfile(targetId: string): Promise<SshProfile | null>;
  saveProfile(profile: SshProfile): Promise<void>;
  removeProfile(targetId: string): Promise<void>;

  ensureTunnel(profile: SshProfile): Promise<LocalRuntimeConnection>;
}

// --- Workspace scratch ------------------------------------------------------

/** Local file-backed workspace scratch. May disappear if scratch becomes
 * server-backed. `updatedAtMs` is the mtime-equivalent. */
export interface ScratchRecord {
  content: string;
  updatedAtMs: number | null;
}

export interface ScratchWriteResult {
  updatedAtMs: number | null;
}

export interface DesktopScratchBridge {
  read(workspaceId: string): Promise<ScratchRecord | null>;
  write(workspaceId: string, content: string): Promise<ScratchWriteResult>;
}

// --- Diagnostics and support ------------------------------------------------

export interface SupportBundleLog {
  source: string;
  path: string;
  bytesRead: number;
  truncated: boolean;
  text: string;
}

/** A support diagnostics bundle. Mirrors Desktop's collected bundle shape. */
export interface SupportBundle {
  schemaVersion: number;
  manifest: {
    appVersion: string;
    runtimeVersion?: string | null;
    runtimeStatus?: string | null;
    runtimeHome?: string | null;
    platform: string;
    timestamp: string;
  };
  health?: {
    runtimeHome: string;
    status: string;
    version: string;
  } | null;
  logs: SupportBundleLog[];
  collectionErrors: string[];
}

export interface SaveJsonInput {
  suggestedFileName: string;
  contents: string;
}

export interface AttachmentInput {
  clientFileId: string;
  fileName: string;
  dataBase64: string;
}

/** A narrow lifecycle marker written to Desktop's renderer-event log. */
export interface RendererEventPayload {
  source: string;
  message: string;
  route?: string | null;
  elapsedMs?: number | null;
}

/**
 * Support UI can use native logs and attachments without importing Tauri.
 * Collection and staging return `null` outside a working native host, matching
 * Desktop's current nullability.
 */
export interface DesktopDiagnosticsBridge {
  logEvent(payload: RendererEventPayload): Promise<void>;
  collectSupportBundle(): Promise<SupportBundle | null>;
  saveJson(input: SaveJsonInput): Promise<string | null>;

  /** Returns the staged attachment path, or null outside the desktop host. */
  stageAttachment(input: AttachmentInput): Promise<string | null>;
  readAttachment(path: string): Promise<string>;
  deleteAttachment(path: string): Promise<void>;
}
