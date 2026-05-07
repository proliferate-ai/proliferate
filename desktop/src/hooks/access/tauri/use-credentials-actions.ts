import { useMemo } from "react";
import {
  deleteEnvVarSecret,
  exportSyncableCloudCredential,
  listConfiguredEnvVarNames,
  listSyncableCloudCredentials,
  restartRuntime,
  setEnvVarSecret,
} from "@/lib/access/tauri/credentials";
import type {
  CloudCredentialProvider,
  LocalCloudCredentialSource,
  SyncCloudCredentialRequestByProvider,
} from "@/lib/access/tauri/credentials";

export type {
  CloudCredentialProvider,
  LocalCloudCredentialSource,
  SyncCloudCredentialRequestByProvider,
};

export function useTauriCredentialsActions() {
  return useMemo(() => ({
    deleteEnvVarSecret,
    exportSyncableCloudCredential,
    listConfiguredEnvVarNames,
    listSyncableCloudCredentials,
    restartRuntime,
    setEnvVarSecret,
  }), []);
}
