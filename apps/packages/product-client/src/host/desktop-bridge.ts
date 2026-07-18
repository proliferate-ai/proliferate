import type { AnyHarnessClientConnection } from "@anyharness/sdk-react";
import type { ServerMeta } from "#product/lib/domain/auth/connect-server";
import type { DesktopUpdaterBridge } from "./desktop-updater-bridge";

/**
 * The typed Desktop bridge: product-level native capabilities grouped by
 * concern. It never exposes generic Tauri `invoke`, raw command names, generic
 * filesystem/process access, cloud CRUD, product authentication, product
 * routing, the embedded browser, or repo/git/worktree/chat/session operations
 * (those flow through AnyHarness). Methods are added only when a migrated
 * product consumer actually needs them.
 *
 * This package defines the shared contract; Desktop supplies the concrete
 * adapter. Types here mirror the concrete shapes Desktop already uses so
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
  connect: DesktopConnectBridge;
}

/**
 * A connection to an AnyHarness runtime at the runtime level — base URL plus an
 * optional auth token, with no workspace identity. Runtime discovery and SSH
 * tunnels resolve before any workspace is selected, so this reuses the SDK's
 * client-connection type (what `getAnyHarnessClient` consumes) rather than the
 * workspace-scoped resolved-connection type.
 */
export type LocalRuntimeConnection = AnyHarnessClientConnection;

export type LocalRuntimeStatus = "starting" | "healthy" | "failed" | "stopped";

/**
 * The latest native sidecar snapshot. ProductClient uses the connection with
 * the normal AnyHarness SDK and uses the status only to preserve Desktop's
 * startup/restart failure behavior.
 */
export interface LocalRuntimeSnapshot {
  connection: LocalRuntimeConnection;
  status: LocalRuntimeStatus;
}

export interface DesktopRuntimeBridge {
  getConnection(): Promise<LocalRuntimeSnapshot>;
  restart(): Promise<LocalRuntimeSnapshot>;
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

export type DirectoryPickerUnavailableReason =
  | "native_host_required"
  | "picker_failed";

/** A directory-picker outcome with cancellation kept distinct from a missing
 * or failed native transport. Product workflows decide how to present the
 * unavailable reason; a normal user cancellation remains silent. */
export type DirectoryPickerResult =
  | { kind: "selected"; path: string }
  | { kind: "cancelled" }
  | { kind: "unavailable"; reason: DirectoryPickerUnavailableReason };

/**
 * Local filesystem and OS access only. Repo inspection, git, worktree, and
 * workspace behavior continue through AnyHarness.
 */
export interface DesktopFilesBridge {
  pickDirectory(): Promise<DirectoryPickerResult>;
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

  /**
   * Apply the macOS traffic-light window chrome (inset title bar / safe-area
   * layout). The product renders the drag-region safe area and asks the host to
   * (re)apply native chrome on mount and window focus. A no-op on a non-mac or
   * non-native host; the product already gates the call on a mac desktop.
   */
  applyMacosWindowChrome(): Promise<void>;

  /**
   * Whether this render runs in the app's main native webview (dev-handoff
   * window port, ruling R2b). `false` on a non-native host, so the dev
   * browser-to-desktop handoff poll never starts there.
   */
  isMainWebviewAvailable(): boolean;
  /**
   * Bring the current native window forward (show + unminimize + focus) after a
   * dev handoff navigates. A no-op on a non-native host. Dev-only.
   */
  revealCurrentWindow(): Promise<void>;
}

// --- Connect to server (self-hosted) ---------------------------------------

/**
 * Result of probing a candidate server's `/meta` endpoint. `ok:false` carries a
 * user-facing reason (unreachable, or not a Proliferate server); it is never a
 * thrown exception. The `meta` payload is the product-owned {@link ServerMeta}.
 */
export type ServerMetaProbeResult =
  | { ok: true; meta: ServerMeta }
  | { ok: false; error: string };

/**
 * The connect-to-self-hosted-server flow (ruling R2a). Only the `/meta` probe
 * crosses the boundary; the product owns the flow's state machine and the
 * deployment switch (through `host.deployment.switchDeployment`).
 */
export interface DesktopConnectBridge {
  fetchServerMeta(url: string): Promise<ServerMetaProbeResult>;
}

// --- Desktop worker ---------------------------------------------------------

export interface WorkerConfiguration {
  targetId: string;
  enrollmentToken?: string | null;
}

export interface WorkerStatus {
  targetId: string;
  status:
    | "running"
    | "started"
    | "already_running_elsewhere"
    | "terminal_shutdown_armed";
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
 * A React render-phase error captured by the product's AppErrorBoundary,
 * forwarded to Desktop's native renderer diagnostic log (not Sentry). The host
 * owns dedup/fingerprint/suppression semantics so the product boundary stays a
 * thin reporter. `error` crosses the boundary as-is; the host derives its
 * message/stack. This is distinct from `logEvent`, which is a narrow lifecycle
 * marker rather than a full error diagnostic.
 */
export interface RenderErrorReport {
  error: unknown;
  componentStack?: string | null;
}

/**
 * Support UI can use native logs and attachments without importing Tauri.
 * Collection and staging return `null` outside a working native host, matching
 * Desktop's current nullability.
 */
export interface DesktopDiagnosticsBridge {
  logEvent(payload: RendererEventPayload): Promise<void>;
  /**
   * Report a product render-phase error to the native renderer diagnostic log.
   * The host applies the same dedup/fingerprint/suppression the pre-move
   * renderer diagnostics did; the product boundary just forwards the error.
   * Fire-and-forget: never rejects into the render path.
   */
  reportRenderError(report: RenderErrorReport): void;
  collectSupportBundle(): Promise<SupportBundle | null>;
  saveJson(input: SaveJsonInput): Promise<string | null>;

  /** Returns the staged attachment path, or null outside the desktop host. */
  stageAttachment(input: AttachmentInput): Promise<string | null>;
  readAttachment(path: string): Promise<string>;
  deleteAttachment(path: string): Promise<void>;
}
