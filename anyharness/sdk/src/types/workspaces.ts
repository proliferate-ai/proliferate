import type { components } from "../generated/openapi.js";

type GeneratedWorkspace = components["schemas"]["Workspace"];

export type WorkspaceKind = components["schemas"]["WorkspaceKind"] | "repo";
export type WorkspaceSurface = components["schemas"]["WorkspaceSurface"];
export type WorkspaceExecutionPhase = components["schemas"]["WorkspaceExecutionPhase"];
export type WorkspaceExecutionSummary = components["schemas"]["WorkspaceExecutionSummary"];
export type WorkspaceCleanupOperation =
  components["schemas"]["WorkspaceCleanupOperation"];
export type OriginKind = components["schemas"]["OriginKind"];
export type OriginEntrypoint = components["schemas"]["OriginEntrypoint"];
export type OriginContext = components["schemas"]["OriginContext"];
export type WorkspaceCreatorContext = components["schemas"]["WorkspaceCreatorContext"];
export type Workspace = Omit<GeneratedWorkspace, "kind" | "repoRootId" | "surface"> & {
  kind: WorkspaceKind;
  repoRootId?: string;
  surface?: WorkspaceSurface;
  sourceRepoRootPath?: string;
  sourceWorkspaceId?: string | null;
  gitProvider?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
};
export type ResolveWorkspaceResponse = components["schemas"]["ResolveWorkspaceResponse"];
export type UpdateWorkspaceDisplayNameRequest =
  components["schemas"]["UpdateWorkspaceDisplayNameRequest"];
export type WorkspaceSessionLaunchModel =
  components["schemas"]["WorkspaceSessionLaunchModel"];
export type WorkspaceSessionLaunchAgent =
  components["schemas"]["WorkspaceSessionLaunchAgent"];
export type WorkspaceSessionLaunchCatalog =
  components["schemas"]["WorkspaceSessionLaunchCatalog"];
export type ResolveWorkspaceFromPathRequest =
  components["schemas"]["ResolveWorkspaceFromPathRequest"];
export type CreateWorkspaceRequest = components["schemas"]["CreateWorkspaceRequest"];
export type CreateWorktreeWorkspaceRequest =
  components["schemas"]["CreateWorktreeWorkspaceRequest"];
export type SetupScriptStatus = components["schemas"]["SetupScriptStatus"];
export type SetupScriptExecution = components["schemas"]["SetupScriptExecution"];
export type CreateWorktreeWorkspaceResponse =
  components["schemas"]["CreateWorktreeWorkspaceResponse"];
export type SetupHintCategory = components["schemas"]["SetupHintCategory"];
export type SetupHint = components["schemas"]["SetupHint"];
export type DetectProjectSetupResponse =
  components["schemas"]["DetectProjectSetupResponse"];
export type GetSetupStatusResponse = components["schemas"]["GetSetupStatusResponse"];
export type StartWorkspaceSetupRequest =
  components["schemas"]["StartWorkspaceSetupRequest"];
export type WorkspaceRetireBlockerCode =
  components["schemas"]["WorkspaceRetireBlockerCode"];
export type WorkspaceRetireBlockerSeverity =
  components["schemas"]["WorkspaceRetireBlockerSeverity"];
export type WorkspaceRetireBlocker =
  components["schemas"]["WorkspaceRetireBlocker"];
export type WorkspaceRetireOutcome =
  components["schemas"]["WorkspaceRetireOutcome"];
export type WorkspaceRetirePreflightResponse =
  components["schemas"]["WorkspaceRetirePreflightResponse"];
export type WorkspaceRetireResponse =
  components["schemas"]["WorkspaceRetireResponse"];
export type WorkspacePurgeOutcome = components["schemas"]["WorkspacePurgeOutcome"];
export type WorkspacePurgePreflightResponse =
  components["schemas"]["WorkspacePurgePreflightResponse"];
export type WorkspacePurgeResponse =
  components["schemas"]["WorkspacePurgeResponse"];
