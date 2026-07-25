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

/** A retained Desktop boot-diagnostics marker. Product code supplies the
 * existing label/metadata; Desktop decides whether and where to record it. */
export interface BootDiagnosticPayload {
  label: string;
  metadata?: Record<string, unknown>;
}

/** One of the existing app bootstrap milestones emitted by the Desktop
 * renderer. `authStatus` carries the existing startup-readiness metadata when
 * that milestone already reported it. */
export interface StartupDiagnosticPayload {
  message: string;
  elapsedMs?: number;
  authStatus?: string;
}

/** The product-derived inputs to Desktop's session-activity transition log. */
export interface SessionActivityDiagnosticSnapshot {
  viewState: string;
  executionPhase: string | null;
  status: string | null;
  transcriptIsStreaming: boolean;
  streamConnectionState: string | null;
  pendingInteractionCount: number;
  executionSummaryUpdatedAt: string | null;
}

/** A currently busy session included in Desktop's periodic debug holdout log. */
export interface SessionActivityDiagnosticHoldout {
  sessionId: string;
  materializedSessionId: string | null;
  workspaceId: string | null;
  viewState: string;
  executionPhase: string | null;
  executionSummary: unknown;
  status: string | null;
  transcriptIsStreaming: boolean;
  streamConnectionState: string | null;
  pendingInteractionCount: number;
}

/**
 * Support UI can use native logs and attachments without importing Tauri.
 * Collection and staging return `null` outside a working native host, matching
 * Desktop's current nullability.
 */
export interface DesktopDiagnosticsBridge {
  logEvent(payload: RendererEventPayload): Promise<void>;
  recordBootEvent(payload: BootDiagnosticPayload): void;
  recordBootEventOnce(payload: BootDiagnosticPayload): void;
  recordStartupEvent(payload: StartupDiagnosticPayload): void;
  isSessionActivityDebugEnabled(): boolean;
  logSessionActivityTransition(
    sessionId: string,
    snapshot: SessionActivityDiagnosticSnapshot,
  ): void;
  forgetSessionActivity(sessionId: string): void;
  logSessionActivityHoldouts(
    holdouts: SessionActivityDiagnosticHoldout[],
  ): void;
  reportReactRenderError(
    error: Error,
    componentStack?: string | null,
  ): void;
  collectSupportBundle(): Promise<SupportBundle | null>;
  saveJson(input: SaveJsonInput): Promise<string | null>;

  /** Returns the staged attachment path, or null outside the desktop host. */
  stageAttachment(input: AttachmentInput): Promise<string | null>;
  readAttachment(path: string): Promise<string>;
  deleteAttachment(path: string): Promise<void>;
}
