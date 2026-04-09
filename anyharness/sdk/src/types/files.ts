export type WorkspaceFileKind = "file" | "directory" | "symlink";

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  kind: WorkspaceFileKind;
  hasChildren?: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  isText?: boolean;
}

export interface ListWorkspaceFilesResponse {
  directoryPath: string;
  entries: WorkspaceFileEntry[];
}

export interface WorkspaceFileSearchResult {
  path: string;
  name: string;
}

export interface SearchWorkspaceFilesResponse {
  results: WorkspaceFileSearchResult[];
}

export interface ReadWorkspaceFileResponse {
  path: string;
  kind: WorkspaceFileKind;
  content: string | null;
  versionToken: string | null;
  encoding: "utf-8" | null;
  sizeBytes: number;
  modifiedAt?: string;
  isText: boolean;
  tooLarge: boolean;
}

export interface WriteWorkspaceFileRequest {
  path: string;
  content: string;
  expectedVersionToken: string;
}

export interface WriteWorkspaceFileResponse {
  path: string;
  versionToken: string;
  sizeBytes: number;
  modifiedAt?: string;
}

export interface StatWorkspaceFileResponse {
  path: string;
  kind: WorkspaceFileKind;
  sizeBytes?: number;
  modifiedAt?: string;
  isText?: boolean;
}
