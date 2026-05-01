import { invoke } from "@tauri-apps/api/core";

export type LocalMcpOAuthCode =
  | "uvx_missing"
  | "port_unavailable"
  | "auth_url_missing"
  | "timeout"
  | "cancelled"
  | "credential_missing"
  | "credential_invalid"
  | "account_mismatch"
  | "process_failed"
  | "cleanup_failed";

export type CredentialStatus =
  | { status: "ready" }
  | {
      status: "not_ready";
      code: CredentialStatusNotReadyCode;
    };

export type CredentialStatusNotReadyCode = Extract<
  LocalMcpOAuthCode,
  "credential_missing" | "credential_invalid" | "account_mismatch"
>;

export type LocalDataDeleteResult =
  | { status: "deleted" }
  | { status: "retryable_failure"; code: "cleanup_failed" };

export type RuntimeEnvResult =
  | { status: "ready"; env: { name: string; value: string }[] }
  | { status: "not_ready"; code: CredentialStatusNotReadyCode };

export interface GmailConnectionHint {
  connectionId: string;
  userGoogleEmail: string;
}

export class LocalMcpOAuthError extends Error {
  readonly code: LocalMcpOAuthCode;

  constructor(code: LocalMcpOAuthCode) {
    super(localMcpOAuthMessage(code));
    this.name = "LocalMcpOAuthError";
    this.code = code;
  }
}

export async function startGoogleWorkspaceMcpAuth(input: {
  setupId: string;
  userGoogleEmail?: string;
  oauthClientId: string;
  oauthClientSecret: string;
}): Promise<{ status: "completed"; userGoogleEmail: string }> {
  try {
    return await invoke<{ status: "completed"; userGoogleEmail: string }>(
      "start_google_workspace_mcp_auth",
      { input },
    );
  } catch (error) {
    throw normalizeLocalMcpOAuthError(error);
  }
}

export async function cancelGoogleWorkspaceMcpAuth(input: {
  setupId: string;
}): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("cancel_google_workspace_mcp_auth", { input });
}

export async function getGoogleWorkspaceMcpCredentialStatus(input: {
  userGoogleEmail: string;
}): Promise<CredentialStatus> {
  return invoke<CredentialStatus>("get_google_workspace_mcp_credential_status", { input });
}

export async function deleteGoogleWorkspaceMcpLocalData(input: {
  connectionId?: string;
  setupId?: string;
  userGoogleEmail: string;
}): Promise<LocalDataDeleteResult> {
  return invoke<LocalDataDeleteResult>("delete_google_workspace_mcp_local_data", { input });
}

export async function reconcileGoogleWorkspaceMcpPendingSetups(input: {
  gmailConnections: GmailConnectionHint[];
}): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("reconcile_google_workspace_mcp_pending_setups", { input });
}

export async function resolveGoogleWorkspaceMcpRuntimeEnv(input: {
  connectionId: string;
  userGoogleEmail: string;
  launchId: string;
}): Promise<RuntimeEnvResult> {
  return invoke<RuntimeEnvResult>("resolve_google_workspace_mcp_runtime_env", { input });
}

export function localMcpOAuthMessage(code: LocalMcpOAuthCode): string {
  switch (code) {
    case "uvx_missing":
      return "`uvx` is required to run this local Gmail MCP.";
    case "port_unavailable":
      return "Gmail sign-in could not reserve a local callback port.";
    case "auth_url_missing":
      return "Gmail sign-in did not return an authorization URL.";
    case "timeout":
      return "Gmail sign-in timed out.";
    case "cancelled":
      return "Gmail sign-in was cancelled.";
    case "credential_missing":
      return "Gmail needs to be reconnected on this desktop.";
    case "credential_invalid":
      return "The saved Gmail credential is invalid or has the wrong scope.";
    case "account_mismatch":
      return "The authorized Google account did not match the saved Gmail account.";
    case "cleanup_failed":
      return "Gmail local data could not be removed. Try deleting again.";
    case "process_failed":
    default:
      return "Gmail setup could not start.";
  }
}

export function normalizeLocalMcpOAuthError(error: unknown): LocalMcpOAuthError {
  const code = extractLocalMcpOAuthCode(error) ?? "process_failed";
  return new LocalMcpOAuthError(code);
}

function extractLocalMcpOAuthCode(error: unknown): LocalMcpOAuthCode | null {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return isLocalMcpOAuthCode(code) ? code : null;
  }
  if (typeof error === "string" && isLocalMcpOAuthCode(error)) {
    return error;
  }
  return null;
}

function isLocalMcpOAuthCode(value: unknown): value is LocalMcpOAuthCode {
  return typeof value === "string" && LOCAL_MCP_OAUTH_CODES.has(value as LocalMcpOAuthCode);
}

const LOCAL_MCP_OAUTH_CODES = new Set<LocalMcpOAuthCode>([
  "uvx_missing",
  "port_unavailable",
  "auth_url_missing",
  "timeout",
  "cancelled",
  "credential_missing",
  "credential_invalid",
  "account_mismatch",
  "process_failed",
  "cleanup_failed",
]);
