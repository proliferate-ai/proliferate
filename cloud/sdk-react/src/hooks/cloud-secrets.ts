import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteOrganizationCloudSecretEnvVar,
  deleteOrganizationCloudSecretFile,
  deletePersonalCloudSecretEnvVar,
  deletePersonalCloudSecretFile,
  deleteWorkspaceCloudSecretEnvVar,
  deleteWorkspaceCloudSecretFile,
  getOrganizationCloudSecrets,
  getPersonalCloudSecrets,
  getWorkspaceCloudSecrets,
  putOrganizationCloudSecretEnvVar,
  putOrganizationCloudSecretFile,
  putPersonalCloudSecretEnvVar,
  putPersonalCloudSecretFile,
  putWorkspaceCloudSecretEnvVar,
  putWorkspaceCloudSecretFile,
  uploadOrganizationCloudSecretFile,
  uploadPersonalCloudSecretFile,
  uploadWorkspaceCloudSecretFile,
  type CloudSecretsResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  organizationCloudSecretsKey,
  personalCloudSecretsKey,
  workspaceCloudSecretsKey,
} from "../lib/query-keys.js";

export type CloudSecretsScope =
  | { kind: "personal" }
  | { kind: "organization"; organizationId: string; canManage?: boolean }
  | { kind: "workspace"; gitOwner: string; gitRepoName: string };

export interface PutCloudSecretEnvVarInput {
  scope: CloudSecretsScope;
  name: string;
  value: string;
}

export interface DeleteCloudSecretEnvVarInput {
  scope: CloudSecretsScope;
  name: string;
}

export interface PutCloudSecretFileInput {
  scope: CloudSecretsScope;
  path: string;
  content?: string;
  file?: Blob;
  fileName?: string;
}

export interface DeleteCloudSecretFileInput {
  scope: CloudSecretsScope;
  path: string;
}

export function cloudSecretsKey(scope: CloudSecretsScope) {
  switch (scope.kind) {
    case "personal":
      return personalCloudSecretsKey();
    case "organization":
      return organizationCloudSecretsKey(scope.organizationId);
    case "workspace":
      return workspaceCloudSecretsKey(scope.gitOwner, scope.gitRepoName);
  }
}

export function useCloudSecrets(scope: CloudSecretsScope | null | undefined, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudSecretsResponse>({
    queryKey: scope ? cloudSecretsKey(scope) : ["cloud", "secrets", "none"],
    queryFn: () => {
      if (!scope) {
        throw new Error("Cloud secrets scope is required.");
      }
      switch (scope.kind) {
        case "personal":
          return getPersonalCloudSecrets(client);
        case "organization":
          return getOrganizationCloudSecrets(scope.organizationId, client);
        case "workspace":
          return getWorkspaceCloudSecrets(scope.gitOwner, scope.gitRepoName, client);
      }
    },
    enabled: enabled && Boolean(scope),
  });
}

export function usePutCloudSecretEnvVar() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSecretsResponse, Error, PutCloudSecretEnvVarInput>({
    mutationFn: ({ scope, name, value }) => {
      switch (scope.kind) {
        case "personal":
          return putPersonalCloudSecretEnvVar(name, { value }, client);
        case "organization":
          return putOrganizationCloudSecretEnvVar(scope.organizationId, name, { value }, client);
        case "workspace":
          return putWorkspaceCloudSecretEnvVar(
            scope.gitOwner,
            scope.gitRepoName,
            name,
            { value },
            client,
          );
      }
    },
    onSuccess: (response, { scope }) => {
      queryClient.setQueryData(cloudSecretsKey(scope), response);
    },
  });
}

export function useDeleteCloudSecretEnvVar() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSecretsResponse, Error, DeleteCloudSecretEnvVarInput>({
    mutationFn: ({ scope, name }) => {
      switch (scope.kind) {
        case "personal":
          return deletePersonalCloudSecretEnvVar(name, client);
        case "organization":
          return deleteOrganizationCloudSecretEnvVar(scope.organizationId, name, client);
        case "workspace":
          return deleteWorkspaceCloudSecretEnvVar(
            scope.gitOwner,
            scope.gitRepoName,
            name,
            client,
          );
      }
    },
    onSuccess: (response, { scope }) => {
      queryClient.setQueryData(cloudSecretsKey(scope), response);
    },
  });
}

export function usePutCloudSecretFile() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSecretsResponse, Error, PutCloudSecretFileInput>({
    mutationFn: ({ scope, path, content, file, fileName }) => {
      if (file) {
        switch (scope.kind) {
          case "personal":
            return uploadPersonalCloudSecretFile({ path, file, fileName }, client);
          case "organization":
            return uploadOrganizationCloudSecretFile(
              scope.organizationId,
              { path, file, fileName },
              client,
            );
          case "workspace":
            return uploadWorkspaceCloudSecretFile(
              scope.gitOwner,
              scope.gitRepoName,
              { path, file, fileName },
              client,
            );
        }
      }
      if (content === undefined) {
        throw new Error("Secret file content is required.");
      }
      switch (scope.kind) {
        case "personal":
          return putPersonalCloudSecretFile({ path, content }, client);
        case "organization":
          return putOrganizationCloudSecretFile(scope.organizationId, { path, content }, client);
        case "workspace":
          return putWorkspaceCloudSecretFile(
            scope.gitOwner,
            scope.gitRepoName,
            { path, content },
            client,
          );
      }
    },
    onSuccess: (response, { scope }) => {
      queryClient.setQueryData(cloudSecretsKey(scope), response);
    },
  });
}

export function useDeleteCloudSecretFile() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSecretsResponse, Error, DeleteCloudSecretFileInput>({
    mutationFn: ({ scope, path }) => {
      switch (scope.kind) {
        case "personal":
          return deletePersonalCloudSecretFile({ path }, client);
        case "organization":
          return deleteOrganizationCloudSecretFile(scope.organizationId, { path }, client);
        case "workspace":
          return deleteWorkspaceCloudSecretFile(
            scope.gitOwner,
            scope.gitRepoName,
            { path },
            client,
          );
      }
    },
    onSuccess: (response, { scope }) => {
      queryClient.setQueryData(cloudSecretsKey(scope), response);
    },
  });
}
