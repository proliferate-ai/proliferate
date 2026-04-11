export { AnyHarnessClient, AnyHarnessError } from "./client/core.js";
export type { AnyHarnessClientOptions, AnyHarnessRequestOptions } from "./client/core.js";

export type {
  HealthResponse,
  ProblemDetails,
} from "./types/runtime.js";

export type {
  AgentInstallState,
  AgentCredentialState,
  AgentReadinessState,
  ArtifactStatus,
  AgentSummary,
  InstallAgentRequest,
  InstallAgentResponse,
  LoginCommand,
  StartAgentLoginResponse,
  ReconcileOutcome,
  ReconcileJobStatus,
  ReconcileAgentsRequest,
  ReconcileAgentResult,
  ReconcileAgentsResponse,
} from "./types/agents.js";

export type {
  ModelRegistry,
  ModelRegistryModel,
} from "./types/model-registries.js";

export type {
  ProviderConfig,
  ModelEntry,
} from "./types/providers.js";

export type {
  RepoRootKind,
  RepoRoot,
} from "./types/repo-roots.js";

export type {
  CoworkRoot,
  CoworkStatus,
  CoworkArtifactType,
  CoworkArtifactSummary,
  CoworkArtifactManifestResponse,
  CoworkArtifactDetailResponse,
  CoworkThread,
  CreateCoworkThreadRequest,
  CreateCoworkThreadResponse,
} from "./types/cowork.js";

export type {
  WorkspaceKind,
  WorkspaceSurface,
  WorkspaceExecutionPhase,
  WorkspaceExecutionSummary,
  Workspace,
  ResolveWorkspaceResponse,
  WorkspaceSessionLaunchModel,
  WorkspaceSessionLaunchAgent,
  WorkspaceSessionLaunchCatalog,
  ResolveWorkspaceFromPathRequest,
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  SetupScriptStatus,
  SetupScriptExecution,
  CreateWorktreeWorkspaceResponse,
  SetupHintCategory,
  SetupHint,
  DetectProjectSetupResponse,
  GetSetupStatusResponse,
  StartWorkspaceSetupRequest,
  UpdateWorkspaceDisplayNameRequest,
} from "./types/workspaces.js";

export type {
  SessionStatus,
  SessionExecutionPhase,
  PendingApprovalSummary,
  SessionExecutionSummary,
  Session,
  SessionMcpEnvVar,
  RawSessionConfigValue,
  RawSessionConfigOption,
  SessionConfigOptionType,
  SessionMcpHeader,
  SessionMcpHttpServer,
  SessionMcpStdioServer,
  SessionMcpServer,
  NormalizedSessionControlValue,
  NormalizedSessionControl,
  NormalizedSessionControls,
  SessionLiveConfigSnapshot,
  GetSessionLiveConfigResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  ConfigApplyState,
  CreateSessionRequest,
  UpdateSessionTitleRequest,
  PromptInputBlock,
  PromptSessionRequest,
  PromptSessionResponse,
  PromptSessionStatus,
  PendingPromptSummary,
  EditPendingPromptRequest,
  PermissionDecision,
  ListSessionEventsOptions,
  ResolvePermissionRequest,
} from "./types/sessions.js";

export type {
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
  SessionEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  SessionEndReason,
  TurnStartedEvent,
  TurnEndedEvent,
  StopReason,
  ItemStartedEvent,
  ItemDeltaEvent,
  ItemCompletedEvent,
  TranscriptItemPayload,
  TranscriptItemKind,
  TranscriptItemStatus,
  TranscriptItemDeltaPayload,
  ContentPart,
  TextContentPart,
  ReasoningContentPart,
  ReasoningVisibility,
  ToolCallContentPart,
  TerminalOutputContentPart,
  TerminalLifecycleEvent,
  FileReadContentPart,
  FileReadScope,
  FileChangeContentPart,
  FileChangeOperation,
  FileOpenTarget,
  PlanContentPart,
  ToolInputTextContentPart,
  ToolResultTextContentPart,
  PlanEntry,
  AvailableCommandsUpdateEvent,
  CurrentModeUpdateEvent,
  ConfigOptionUpdateEvent,
  SessionStateUpdateEvent,
  SessionInfoUpdateEvent,
  UsageUpdateEvent,
  PendingPromptAddedEvent,
  PendingPromptUpdatedEvent,
  PendingPromptRemovedEvent,
  PendingPromptRemovalReason,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
  PermissionOutcome,
  ErrorEvent,
} from "./types/events.js";

export type {
  TranscriptState,
  TurnRecord,
  FileBadge,
  TranscriptItem,
  TranscriptBaseItem,
  UserMessageItem,
  AssistantProseItem,
  ThoughtItem,
  ToolCallItem,
  ToolCallSemanticKind,
  PlanItem,
  CanonicalPlan,
  CanonicalPlanSourceKind,
  ErrorItem,
  UnknownItem,
  PendingApproval,
  PendingPromptEntry,
  UsageState,
} from "./types/reducer.js";

export {
  createTranscriptState,
  reduceEvent,
  reduceEvents,
  isFileReadPart,
  isFileChangePart,
} from "./reducer/transcript.js";
export type { ReduceOptions } from "./reducer/transcript.js";
export type {
  ToolBackgroundWorkMetadata,
  ToolBackgroundWorkState,
  ToolBackgroundWorkTrackerKind,
} from "./reducer/background-work.js";
export { parseToolBackgroundWork } from "./reducer/background-work.js";

export { deriveCanonicalPlan } from "./reducer/canonical-plan.js";

export type {
  WorkspaceFileKind,
  WorkspaceFileEntry,
  ListWorkspaceFilesResponse,
  WorkspaceFileSearchResult,
  SearchWorkspaceFilesResponse,
  ReadWorkspaceFileResponse,
  WriteWorkspaceFileRequest,
  WriteWorkspaceFileResponse,
  StatWorkspaceFileResponse,
} from "./types/files.js";

export type {
  GitOperation,
  GitFileStatus,
  GitIncludedState,
  GitStatusSummary,
  GitActionAvailability,
  GitChangedFile,
  GitStatusSnapshot,
  GitDiffResponse,
  GitBranchRef,
  RenameBranchRequest,
  RenameBranchResponse,
  StagePathsRequest,
  UnstagePathsRequest,
  CommitRequest,
  CommitResponse,
  PushRequest,
  PushResponse,
} from "./types/git.js";

export type {
  PullRequestState,
  PullRequestSummary,
  CurrentPullRequestResponse,
  CreatePullRequestRequest,
  CreatePullRequestResponse,
} from "./types/hosting.js";

export type {
  TerminalStatus,
  TerminalRecord,
  CreateTerminalRequest,
  ResizeTerminalRequest,
} from "./types/terminals.js";

export type {
  RunCommandRequest,
  RunCommandResponse,
} from "./types/processes.js";

export { connectTerminal } from "./streams/terminals.js";
export type { TerminalStreamOptions, TerminalStreamHandle } from "./streams/terminals.js";

export { streamSession } from "./streams/sessions.js";
export type { SessionStreamOptions, SessionStreamHandle } from "./streams/sessions.js";
