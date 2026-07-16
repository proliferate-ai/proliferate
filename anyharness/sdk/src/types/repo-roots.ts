import type { components } from "../generated/openapi.js";

export type RepoRootKind = components["schemas"]["RepoRootKind"];
export type RepoRoot = components["schemas"]["RepoRoot"];
export type ResolveRepoRootFromPathRequest =
  components["schemas"]["ResolveRepoRootFromPathRequest"];
export type PrepareRepoRootMobilityDestinationRequest =
  components["schemas"]["PrepareRepoRootMobilityDestinationRequest"];
export type PrepareRepoRootMobilityDestinationResponse =
  components["schemas"]["PrepareRepoRootMobilityDestinationResponse"];
export type GitBranchRef = components["schemas"]["GitBranchRef"];
export type DetectProjectSetupResponse =
  components["schemas"]["DetectProjectSetupResponse"];

// Local repository / workspace materialization (PR 3).
export type RepositoryProvider = components["schemas"]["RepositoryProvider"];
export type MaterializeRepositoryTarget =
  components["schemas"]["MaterializeRepositoryTarget"];
export type RepoRootMaterializationMode =
  components["schemas"]["RepoRootMaterializationMode"];
export type RepoRootMaterializationOutcome =
  components["schemas"]["RepoRootMaterializationOutcome"];
export type MaterializeRepoRootRequest =
  components["schemas"]["MaterializeRepoRootRequest"];
export type MaterializeRepoRootResponse =
  components["schemas"]["MaterializeRepoRootResponse"];
export type WorkspaceMaterializationOutcome =
  components["schemas"]["WorkspaceMaterializationOutcome"];
export type MaterializeWorkspaceAtRefRequest =
  components["schemas"]["MaterializeWorkspaceAtRefRequest"];
export type MaterializeWorkspaceAtRefResponse =
  components["schemas"]["MaterializeWorkspaceAtRefResponse"];
