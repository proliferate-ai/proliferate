import type { components } from "../generated/openapi.js";

export type GitOperation = components["schemas"]["GitOperation"];
export type GitFileStatus = components["schemas"]["GitFileStatus"];
export type GitIncludedState = components["schemas"]["GitIncludedState"];
export type GitStatusSummary = components["schemas"]["GitStatusSummary"];
export type GitActionAvailability = components["schemas"]["GitActionAvailability"];
export type GitChangedFile = components["schemas"]["GitChangedFile"];
export type GitStatusSnapshot = components["schemas"]["GitStatusSnapshot"];
export type GitDiffScope = components["schemas"]["GitDiffScope"];
export type GitDiffFile = components["schemas"]["GitDiffFile"];
export type GitDiffResponse = components["schemas"]["GitDiffResponse"];
export type GitBranchDiffFilesResponse = components["schemas"]["GitBranchDiffFilesResponse"];
export type GitBranchRef = components["schemas"]["GitBranchRef"];
export type StagePathsRequest = components["schemas"]["StagePathsRequest"];
export type UnstagePathsRequest = components["schemas"]["UnstagePathsRequest"];
export type CommitRequest = components["schemas"]["CommitRequest"];
export type CommitResponse = components["schemas"]["CommitResponse"];
export type PushRequest = components["schemas"]["PushRequest"];
export type PushResponse = components["schemas"]["PushResponse"];

export interface RenameBranchRequest {
  newName: string;
}

export interface RenameBranchResponse {
  oldName: string;
  newName: string;
}

export interface GitDiffOptions {
  scope?: GitDiffScope | null;
  baseRef?: string | null;
  oldPath?: string | null;
}

export interface ListBranchDiffFilesOptions {
  baseRef?: string | null;
}
