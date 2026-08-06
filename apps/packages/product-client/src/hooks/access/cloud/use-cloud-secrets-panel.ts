import { useEffect } from "react";
import {
  useCloudSecrets,
  useDeleteCloudSecretEnvVar,
  useDeleteCloudSecretFile,
  usePutCloudSecretEnvVar,
  usePutCloudSecretFile,
  type CloudSecretsScope,
} from "@proliferate/cloud-sdk-react";
import type { SecretFilePathMode } from "#product/lib/domain/secrets/secret-editor-vocabulary";
import type {
  SecretMaterializationView,
  SecretMetadata,
} from "#product/lib/domain/secrets/secret-management-panel";

export interface CloudSecretsPanelModel {
  title: string;
  description: string;
  filePathMode: SecretFilePathMode;
  envVars: readonly SecretMetadata[];
  files: readonly SecretMetadata[];
  materialization?: SecretMaterializationView | null;
  canManage?: boolean;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  onSaveEnvVar: (name: string, value: string) => void;
  onDeleteEnvVar: (name: string) => void;
  onSaveFile: (path: string, input: { content: string } | { file: File }) => void;
  onDeleteFile: (path: string) => void;
}

export interface UseCloudSecretsPanelOptions {
  scope: CloudSecretsScope;
  enabled?: boolean;
}

/**
 * Data wiring for the secrets panel: the Cloud queries/mutations for a
 * secrets scope (personal/organization/workspace), shaped directly into
 * `SecretManagementPanel`'s full prop set. Callers compose this hook with
 * the presentational `SecretManagementPanel` pattern:
 *
 *   const panel = useCloudSecretsPanel({ scope });
 *   return <SecretManagementPanel {...panel} />;
 *
 * Split out of the former `CloudSecretsSettingsSurface`,
 * which mixed this data wiring with the panel render in one connected
 * component. The 3 real call sites (Organization/Personal/Repo-environment
 * secrets panes) now import the hook and the pattern separately.
 */
export function useCloudSecretsPanel({
  scope,
  enabled = true,
}: UseCloudSecretsPanelOptions): CloudSecretsPanelModel {
  const secrets = useCloudSecrets(scope, enabled);
  const putEnvVar = usePutCloudSecretEnvVar();
  const deleteEnvVar = useDeleteCloudSecretEnvVar();
  const putFile = usePutCloudSecretFile();
  const deleteFile = useDeleteCloudSecretFile();
  const { reset: resetPutEnvVar } = putEnvVar;
  const { reset: resetDeleteEnvVar } = deleteEnvVar;
  const { reset: resetPutFile } = putFile;
  const { reset: resetDeleteFile } = deleteFile;
  const meta = cloudSecretsPanelMetadata(scope);
  const scopeKey = cloudSecretsScopeKey(scope);
  const mutationError = putEnvVar.error
    ?? deleteEnvVar.error
    ?? putFile.error
    ?? deleteFile.error;
  const queryError = enabled && secrets.error instanceof Error ? secrets.error.message : null;
  const saving = putEnvVar.isPending
    || deleteEnvVar.isPending
    || putFile.isPending
    || deleteFile.isPending;

  // Same scope-change reset the old surface performed: switching scopes
  // (e.g. one repo's environment to another) should drop any in-flight
  // mutation state from the prior scope rather than bleed into the next one.
  useEffect(() => {
    resetPutEnvVar();
    resetDeleteEnvVar();
    resetPutFile();
    resetDeleteFile();
  }, [enabled, resetDeleteEnvVar, resetDeleteFile, resetPutEnvVar, resetPutFile, scopeKey]);

  return {
    title: meta.title,
    description: meta.description,
    filePathMode: meta.filePathMode,
    canManage: meta.canManage && enabled && !secrets.isError,
    loading: secrets.isLoading,
    saving,
    error: mutationError?.message ?? queryError,
    envVars: (secrets.data?.envVars ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      byteSize: item.byteSize,
      updatedAt: item.updatedAt,
    })),
    files: (secrets.data?.files ?? []).map((item) => ({
      id: item.id,
      path: item.path,
      byteSize: item.byteSize,
      updatedAt: item.updatedAt,
    })),
    materialization: secrets.data?.materialization ?? null,
    onSaveEnvVar: (name, value) => {
      putEnvVar.mutate({ scope, name, value });
    },
    onDeleteEnvVar: (name) => {
      deleteEnvVar.mutate({ scope, name });
    },
    onSaveFile: (path, input) => {
      if ("file" in input) {
        putFile.mutate({ scope, path, file: input.file, fileName: input.file.name });
      } else {
        putFile.mutate({ scope, path, content: input.content });
      }
    },
    onDeleteFile: (path) => {
      deleteFile.mutate({ scope, path });
    },
  };
}

/**
 * Scope-driven title/description/filePathMode/canManage copy for the panel.
 * `canManage` here is the scope's raw authority (e.g. org admin-ness); the
 * hook above ANDs it with runtime `enabled`/query-error state before handing
 * it to `SecretManagementPanel` — this function alone is not the final value.
 */
export function cloudSecretsPanelMetadata(scope: CloudSecretsScope): {
  title: string;
  description: string;
  filePathMode: "absolute" | "relative";
  canManage: boolean;
} {
  switch (scope.kind) {
    case "personal":
      return {
        title: "Personal secrets",
        description: "Available in your cloud sandbox. Personal env vars override organization env vars.",
        filePathMode: "absolute",
        canManage: true,
      };
    case "organization":
      return {
        title: "Organization secrets",
        description: "Available in every member's cloud sandbox. Personal and workspace env vars can override organization env vars.",
        filePathMode: "absolute",
        canManage: scope.canManage ?? false,
      };
    case "workspace":
      return {
        title: "Workspace secrets",
        description: "Available only for this cloud environment's AnyHarness-launched processes. Workspace env vars override personal and organization env vars.",
        filePathMode: "relative",
        canManage: true,
      };
  }
}

function cloudSecretsScopeKey(scope: CloudSecretsScope): string {
  switch (scope.kind) {
    case "personal":
      return "personal";
    case "organization":
      return `organization:${scope.organizationId}`;
    case "workspace":
      return `workspace:${scope.gitOwner}/${scope.gitRepoName}`;
  }
}
