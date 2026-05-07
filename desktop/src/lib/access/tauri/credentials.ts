import { invoke } from "@tauri-apps/api/core";
import type { RuntimeInfo } from "./runtime";

export type CloudCredentialProvider = "claude" | "codex" | "gemini";

export interface LocalCloudCredentialSource {
  provider: CloudCredentialProvider;
  authMode: "env" | "file";
  detected: boolean;
}

export interface SyncEnvCredentialRequest {
  authMode: "env";
  envVars: Record<string, string>;
}

export interface SyncClaudeFileCredentialRequest {
  authMode: "file";
  files: Array<{
    relativePath: ".claude/.credentials.json" | ".claude.json";
    contentBase64: string;
  }>;
}

export interface SyncCodexCredentialRequest {
  authMode: "file";
  files: Array<{
    relativePath: ".codex/auth.json";
    contentBase64: string;
  }>;
}

export interface SyncGeminiFileCredentialRequest {
  authMode: "file";
  files: Array<{
    relativePath: ".gemini/oauth_creds.json" | ".gemini/settings.json";
    contentBase64: string;
  }>;
}

export type SyncClaudeCredentialRequest =
  | SyncEnvCredentialRequest
  | SyncClaudeFileCredentialRequest;

export type SyncGeminiCredentialRequest =
  | SyncEnvCredentialRequest
  | SyncGeminiFileCredentialRequest;

export interface SyncCloudCredentialRequestByProvider {
  claude: SyncClaudeCredentialRequest;
  codex: SyncCodexCredentialRequest;
  gemini: SyncGeminiCredentialRequest;
}

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

export async function exportSyncableCloudCredential<P extends CloudCredentialProvider>(
  provider: P,
): Promise<SyncCloudCredentialRequestByProvider[P]> {
  return invoke<SyncCloudCredentialRequestByProvider[P]>(
    "export_syncable_cloud_credential",
    { provider },
  );
}
