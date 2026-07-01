import { useEffect } from "react";
import {
  useCloudSecrets,
  useDeleteCloudSecretEnvVar,
  useDeleteCloudSecretFile,
  usePutCloudSecretEnvVar,
  usePutCloudSecretFile,
  type CloudSecretsScope,
} from "@proliferate/cloud-sdk-react";
import { SecretManagementPanel } from "@proliferate/product-ui/secrets/SecretManagementPanel";

export interface CloudSecretsSettingsSurfaceProps {
  scope: CloudSecretsScope;
  enabled?: boolean;
}

export function CloudSecretsSettingsSurface({
  scope,
  enabled = true,
}: CloudSecretsSettingsSurfaceProps) {
  const secrets = useCloudSecrets(scope, enabled);
  const putEnvVar = usePutCloudSecretEnvVar();
  const deleteEnvVar = useDeleteCloudSecretEnvVar();
  const putFile = usePutCloudSecretFile();
  const deleteFile = useDeleteCloudSecretFile();
  const { reset: resetPutEnvVar } = putEnvVar;
  const { reset: resetDeleteEnvVar } = deleteEnvVar;
  const { reset: resetPutFile } = putFile;
  const { reset: resetDeleteFile } = deleteFile;
  const meta = scopeMetadata(scope);
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

  useEffect(() => {
    resetPutEnvVar();
    resetDeleteEnvVar();
    resetPutFile();
    resetDeleteFile();
  }, [enabled, resetDeleteEnvVar, resetDeleteFile, resetPutEnvVar, resetPutFile, scopeKey]);

  return (
    <SecretManagementPanel
      title={meta.title}
      description={meta.description}
      filePathMode={meta.filePathMode}
      canManage={meta.canManage && enabled && !secrets.isError}
      loading={secrets.isLoading}
      saving={saving}
      error={mutationError?.message ?? queryError}
      envVars={(secrets.data?.envVars ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        byteSize: item.byteSize,
        updatedAt: item.updatedAt,
      }))}
      files={(secrets.data?.files ?? []).map((item) => ({
        id: item.id,
        path: item.path,
        byteSize: item.byteSize,
        updatedAt: item.updatedAt,
      }))}
      materialization={secrets.data?.materialization ?? null}
      onSaveEnvVar={(name, value) => {
        putEnvVar.mutate({ scope, name, value });
      }}
      onDeleteEnvVar={(name) => {
        deleteEnvVar.mutate({ scope, name });
      }}
      onSaveFile={(path, input) => {
        if ("file" in input) {
          putFile.mutate({ scope, path, file: input.file, fileName: input.file.name });
        } else {
          putFile.mutate({ scope, path, content: input.content });
        }
      }}
      onDeleteFile={(path) => {
        deleteFile.mutate({ scope, path });
      }}
    />
  );
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

function scopeMetadata(scope: CloudSecretsScope): {
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
