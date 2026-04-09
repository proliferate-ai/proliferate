import { invoke } from "@tauri-apps/api/core";
import type { RuntimeInfo } from "./runtime";

export interface LocalCloudCredentialSource {
  provider: "claude" | "codex";
  authMode: "env" | "file";
  detected: boolean;
}

export interface SyncEnvCredentialRequest {
  authMode: "env";
  envVars: Record<string, string>;
}

/** Approved Claude file-backed auth paths for cloud sync. */
export type ClaudeFilePath = ".claude/.credentials.json" | ".claude.json";
export type CodexFilePath = ".codex/auth.json";

export interface SyncClaudeFileCredentialRequest {
  authMode: "file";
  files: Array<{
    relativePath: ClaudeFilePath;
    contentBase64: string;
  }>;
}

export interface SyncCodexCredentialRequest {
  authMode: "file";
  files: Array<{
    relativePath: CodexFilePath;
    contentBase64: string;
  }>;
}

export type SyncClaudeCredentialRequest =
  | SyncEnvCredentialRequest
  | SyncClaudeFileCredentialRequest;

export async function listConfiguredEnvVarNames(): Promise<string[]> {
  return invoke<string[]>("list_configured_env_var_names");
}

export async function setEnvVarSecret(
  name: string,
  value: string,
): Promise<void> {
  return invoke("set_env_var_secret", { name, value });
}

export async function deleteEnvVarSecret(name: string): Promise<void> {
  return invoke("delete_env_var_secret", { name });
}

export async function restartRuntime(): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>("restart_runtime");
}

export async function listSyncableCloudCredentials(): Promise<LocalCloudCredentialSource[]> {
  return invoke<LocalCloudCredentialSource[]>("list_syncable_cloud_credentials");
}

export async function exportSyncableCloudCredential(
  provider: "claude",
): Promise<SyncClaudeCredentialRequest>;
export async function exportSyncableCloudCredential(
  provider: "codex",
): Promise<SyncCodexCredentialRequest>;
export async function exportSyncableCloudCredential(
  provider: "claude" | "codex",
): Promise<SyncClaudeCredentialRequest | SyncCodexCredentialRequest> {
  return invoke<SyncClaudeCredentialRequest | SyncCodexCredentialRequest>(
    "export_syncable_cloud_credential",
    { provider },
  );
}
