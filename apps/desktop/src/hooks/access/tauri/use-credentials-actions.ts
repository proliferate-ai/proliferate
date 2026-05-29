import { useMemo } from "react";
import {
  deleteEnvVarSecret,
  exportSyncableAgentAuthCredential,
  listConfiguredEnvVarNames,
  listSyncableAgentAuthCredentials,
  restartRuntime,
  setEnvVarSecret,
} from "@/lib/access/tauri/credentials";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
  SyncAgentAuthCredentialRequestByProvider,
} from "@/lib/access/tauri/credentials";

export type {
  AgentAuthProvider,
  LocalAgentAuthSource,
  SyncAgentAuthCredentialRequestByProvider,
};

export function useTauriCredentialsActions() {
  return useMemo(() => ({
    deleteEnvVarSecret,
    exportSyncableAgentAuthCredential,
    listConfiguredEnvVarNames,
    listSyncableAgentAuthCredentials,
    restartRuntime,
    setEnvVarSecret,
  }), []);
}
