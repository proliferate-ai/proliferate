import type { components, paths } from "./generated/openapi";
import createClient, { type Middleware } from "openapi-fetch";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
  type StoredAuthSession,
} from "@/platform/tauri/auth";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { getCurrentAuthSession } from "@/lib/domain/auth/current-auth-session";
import { isSessionExpiring, refreshDesktopUserSession } from "@/lib/integrations/auth/proliferate-auth";

// Narrow string unions — kept hand-written because the server declares these as `str`
// and the generated types would be too loose (`string`) for UI switch/display logic.
export type CloudWorkspaceStatus =
  | "queued"
  | "provisioning"
  | "syncing_credentials"
  | "cloning_repo"
  | "starting_runtime"
  | "ready"
  | "stopped"
  | "error";

export type CloudAgentKind = "claude" | "codex";

// Generated type aliases — names preserved so all existing import sites are unchanged.
export type RepoRef                   = components["schemas"]["RepoRef"];
export type CloudCredentialStatus     = components["schemas"]["CredentialStatus"];
export type BillingPlanInfo           = components["schemas"]["CloudPlanInfo"];
export type CloudWorkspaceSummary     = components["schemas"]["WorkspaceSummary"];
export type CloudWorkspaceDetail      = components["schemas"]["WorkspaceDetail"];
export type CloudConnectionInfo       = components["schemas"]["WorkspaceConnection"];
export type CloudRepoBranchesResponse = components["schemas"]["RepoBranchesResponse"];
export type CloudRepoConfigSummary    = components["schemas"]["CloudRepoConfigSummary"];
export type CloudRepoConfigsListResponse = components["schemas"]["CloudRepoConfigsListResponse"];
export type CloudRepoFileMetadata     = components["schemas"]["CloudRepoFileMetadata"];
export type CloudRepoConfigResponse   = components["schemas"]["CloudRepoConfigResponse"];
export type SaveCloudRepoConfigRequest = components["schemas"]["SaveCloudRepoConfigRequest"];
export type CloudMcpConnectionSyncStatus = components["schemas"]["CloudMcpConnectionSyncStatus"];
export type SyncCloudMcpConnectionRequest = components["schemas"]["SyncCloudMcpConnectionRequest"];
export type PutCloudRepoFileRequest   = components["schemas"]["PutCloudRepoFileRequest"];
export type CloudWorkspaceRepoConfigStatusResponse = components["schemas"]["CloudWorkspaceRepoConfigStatusResponse"];
export type ResyncCloudWorkspaceFilesResponse = components["schemas"]["ResyncCloudWorkspaceFilesResponse"];
export type RunCloudWorkspaceSetupResponse = components["schemas"]["RunCloudWorkspaceSetupResponse"];
export type CreateCloudWorkspaceRequest = components["schemas"]["CreateCloudWorkspaceRequest"];
export type GenerateSessionTitleRequest = components["schemas"]["GenerateSessionTitleRequest"];
export type GenerateSessionTitleResponse = components["schemas"]["GenerateSessionTitleResponse"];
export type SupportMessageContext     = components["schemas"]["SupportMessageContext"];
export type SendSupportMessageRequest = components["schemas"]["SupportMessageRequest"];

export class ProliferateClientError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ProliferateClientError";
    this.status = status;
    this.code = code;
  }
}

async function loadValidSession(): Promise<StoredAuthSession | null> {
  const current = getCurrentAuthSession();
  const stored = await getStoredAuthSession();
  const candidate = current ?? stored;
  if (!candidate) return null;
  if (!isSessionExpiring(candidate)) {
    return candidate;
  }
  try {
    const refreshed = await refreshDesktopUserSession(candidate.refresh_token);
    await setStoredAuthSession(refreshed);
    return refreshed;
  } catch {
    await clearStoredAuthSession();
    return null;
  }
}

async function refreshSessionOrThrow(
  session: StoredAuthSession,
): Promise<StoredAuthSession> {
  const refreshed = await refreshDesktopUserSession(session.refresh_token);
  await setStoredAuthSession(refreshed);
  return refreshed;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    if (isDevAuthBypassed()) {
      throw new ProliferateClientError(
        "Cloud workspaces require real sign-in. Set VITE_DEV_DISABLE_AUTH=false and sign in.",
        401,
        "dev_auth_bypass",
      );
    }
    const session = await loadValidSession();
    if (!session) {
      throw new ProliferateClientError(
        "You must sign in to use cloud workspaces.",
        401,
        "unauthorized",
      );
    }
    request.headers.set("accept", "application/json");
    request.headers.set("authorization", `Bearer ${session.access_token}`);
    if (request.body && !request.headers.has("content-type")) {
      request.headers.set("content-type", "application/json");
    }
    return request;
  },

  async onResponse({ response, request }) {
    if (response.status === 401) {
      const stored = await getStoredAuthSession();
      if (!stored) {
        await clearStoredAuthSession();
        throw new ProliferateClientError(
          "Session expired. Please sign in again.",
          401,
          "unauthorized",
        );
      }
      try {
        const refreshed = await refreshSessionOrThrow(stored);
        const retryHeaders = new Headers(request.headers);
        retryHeaders.set("authorization", `Bearer ${refreshed.access_token}`);
        return fetch(new Request(request, { headers: retryHeaders }));
      } catch {
        await clearStoredAuthSession();
        throw new ProliferateClientError(
          "Session expired. Please sign in again.",
          401,
          "unauthorized",
        );
      }
    }
    return response;
  },
};

const errorMiddleware: Middleware = {
  async onResponse({ response }) {
    if (!response.ok && response.status !== 401) {
      let payload: { detail?: { code?: string; message?: string } | string } | undefined;
      try {
        payload = await response.clone().json() as typeof payload;
      } catch {
        // fall through
      }
      const detail = payload?.detail;
      if (detail && typeof detail === "object") {
        throw new ProliferateClientError(
          detail.message ?? response.statusText ?? "Request failed",
          response.status,
          detail.code ?? null,
        );
      }
      if (typeof detail === "string") {
        throw new ProliferateClientError(detail, response.status, null);
      }
      throw new ProliferateClientError(
        response.statusText || "Request failed",
        response.status,
        null,
      );
    }
    return response;
  },
};

function createProliferateClient() {
  const client = createClient<paths>({ baseUrl: getProliferateApiBaseUrl() });
  client.use(authMiddleware);
  client.use(errorMiddleware);
  return client;
}

let _client: ReturnType<typeof createProliferateClient> | null = null;

export function getProliferateClient() {
  if (!_client) _client = createProliferateClient();
  return _client;
}
