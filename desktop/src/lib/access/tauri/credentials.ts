import { invoke } from "@tauri-apps/api/core";
import type { RuntimeInfo } from "./runtime";

export type AgentAuthProvider = "claude" | "codex" | "gemini";

export interface LocalAgentAuthSource {
  provider: AgentAuthProvider;
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

export type SyncClaudeCredentialRequest = SyncClaudeFileCredentialRequest;

export type SyncGeminiCredentialRequest =
  | SyncEnvCredentialRequest
  | SyncGeminiFileCredentialRequest;

export interface SyncAgentAuthCredentialRequestByProvider {
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

export async function listSyncableAgentAuthCredentials(): Promise<LocalAgentAuthSource[]> {
  return invoke<LocalAgentAuthSource[]>("list_syncable_agent_auth_credentials");
}

export async function exportSyncableAgentAuthCredential<P extends AgentAuthProvider>(
  provider: P,
): Promise<SyncAgentAuthCredentialRequestByProvider[P]> {
  return invoke<SyncAgentAuthCredentialRequestByProvider[P]>(
    "export_syncable_agent_auth_credential",
    { provider },
  );
}
