import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";

/**
 * The typed Desktop bridge: product-level native capabilities grouped by
 * concern. It never exposes generic Tauri `invoke`, raw command names, generic
 * filesystem/process access, cloud CRUD, product authentication, product
 * routing, the embedded browser, or repo/git/worktree/chat/session operations
 * (those flow through AnyHarness). Methods are added only when a migrated
 * product consumer actually needs them.
 *
 * This package defines the shared contract; the Desktop adapter is implemented
 * in a later PR.
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
 * The connection to a local AnyHarness runtime. ProductClient feeds this to the
 * same AnyHarness SDK it uses for cloud work, so it reuses the SDK's resolved
 * connection shape rather than defining a parallel one.
 */
export type LocalRuntimeConnection = AnyHarnessResolvedConnection;

export interface DesktopRuntimeBridge {
  getConnection(): Promise<LocalRuntimeConnection>;
  restart(): Promise<LocalRuntimeConnection>;
}

/** A local open destination: an editor, Finder, or a terminal. */
export interface OpenTarget {
  id: string;
  label: string;
  kind: "editor" | "finder" | "terminal";
}

/**
 * Local filesystem and OS access only. Repo inspection, git, worktree, and
 * workspace behavior continue through AnyHarness.
 */
export interface DesktopFilesBridge {
  pickDirectory(): Promise<string | null>;
  getHomeDirectory(): Promise<string>;
  isDirectory(path: string): Promise<boolean>;

  listOpenTargets(path: string): Promise<OpenTarget[]>;
  openTarget(target: OpenTarget, path: string): Promise<void>;

  reveal(path: string): Promise<void>;
  openTerminal(path: string): Promise<void>;
}

/**
 * Local model/provider credentials (not Proliferate login credentials — those
 * remain owned by `host.auth`).
 */
export interface DesktopCredentialsBridge {
  listConfigured(): Promise<string[]>;
  set(name: string, secret: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface NativeMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
}

export interface MenuPosition {
  x: number;
  y: number;
}

/** A product-level command id dispatched from a native menu selection. */
export type ProductCommand = string;

/**
 * The shared product owns menu content and native-state intents; Desktop owns
 * the native menu, Dock, and WebView implementation.
 */
export interface DesktopNativeUiBridge {
  showContextMenu(items: NativeMenuItem[], position: MenuPosition): Promise<void>;
  subscribeMenuCommands(listener: (command: ProductCommand) => void): () => void;

  setRunningAgentCount(count: number): Promise<void>;
  setWorkspaceActivity(state: "idle" | "attention"): Promise<void>;
  setZoom(scale: number): Promise<void>;
}

/** An available desktop update. Native update handles remain private to the
 * Desktop implementation. */
export interface DesktopUpdate {
  version: string;
  title: string | null;
}

export interface DesktopUpdaterBridge {
  getVersion(): Promise<string>;
  check(): Promise<DesktopUpdate | null>;
  downloadAndInstall(update: DesktopUpdate): Promise<void>;
  relaunch(): Promise<void>;
}

export interface WorkerConfiguration {
  targetId: string;
  enrollmentToken?: string | null;
}

export interface WorkerStatus {
  targetId: string;
  status: "running" | "started";
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

export interface SshProfile {
  targetId: string;
  host: string;
  user: string;
  port: number;
  identityFile?: string | null;
  remoteRuntimePort: number;
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

/** Local file-backed workspace scratch. May disappear if scratch becomes
 * server-backed. */
export interface ScratchRecord {
  content: string;
  updatedAtMs: number | null;
}

export interface DesktopScratchBridge {
  read(workspaceId: string): Promise<ScratchRecord | null>;
  write(workspaceId: string, content: string): Promise<void>;
}

export interface SupportBundle {
  schemaVersion: number;
  contents: string;
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

export interface StagedAttachment {
  path: string;
}

/**
 * Support UI can use native logs and attachments without importing Tauri.
 */
export interface DesktopDiagnosticsBridge {
  collectSupportBundle(): Promise<SupportBundle>;
  saveJson(input: SaveJsonInput): Promise<string | null>;

  stageAttachment(input: AttachmentInput): Promise<StagedAttachment>;
  readAttachment(path: string): Promise<string>;
  deleteAttachment(path: string): Promise<void>;
}
