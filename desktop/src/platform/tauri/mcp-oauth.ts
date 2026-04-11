import { invoke } from "@tauri-apps/api/core";

export interface ConnectOAuthConnectorInput {
  connectionId: string;
  serverUrl: string;
}

export interface ConnectorOAuthBundleState {
  hasBundle: boolean;
  expiresAt: string | null;
}

export interface GetValidOAuthAccessTokenInput {
  connectionId: string;
  minRemainingSeconds: number;
}

export type GetValidOAuthAccessTokenResult =
  | {
      kind: "ready";
      accessToken: string;
      expiresAt: string | null;
    }
  | {
      kind: "missing";
    }
  | {
      kind: "needsReconnect";
    };

export type ConnectOAuthConnectorResult =
  | { kind: "completed" }
  | { kind: "canceled" };

export type OAuthCommandErrorKind =
  | "discovery_failed"
  | "registration_failed"
  | "exchange_failed"
  | "refresh_failed"
  | "callback_timeout"
  | "state_mismatch"
  | "unexpected";

interface RawOAuthCommandError {
  kind?: unknown;
  message?: unknown;
  retryable?: unknown;
}

export class OAuthConnectorCommandError extends Error {
  readonly kind: OAuthCommandErrorKind;

  readonly retryable: boolean;

  constructor(kind: OAuthCommandErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = "OAuthConnectorCommandError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

function isOAuthCommandErrorKind(value: unknown): value is OAuthCommandErrorKind {
  return value === "discovery_failed"
    || value === "registration_failed"
    || value === "exchange_failed"
    || value === "refresh_failed"
    || value === "callback_timeout"
    || value === "state_mismatch"
    || value === "unexpected";
}

function normalizeOAuthCommandError(error: unknown): OAuthConnectorCommandError {
  if (error instanceof OAuthConnectorCommandError) {
    return error;
  }

  if (typeof error === "string") {
    try {
      return normalizeOAuthCommandError(JSON.parse(error) as unknown);
    } catch {
      return new OAuthConnectorCommandError(
        "unexpected",
        "Couldn't complete OAuth for this connector.",
        false,
      );
    }
  }

  if (error && typeof error === "object") {
    const raw = error as RawOAuthCommandError;
    if (isOAuthCommandErrorKind(raw.kind)) {
      return new OAuthConnectorCommandError(
        raw.kind,
        typeof raw.message === "string" ? raw.message : "Couldn't complete OAuth for this connector.",
        typeof raw.retryable === "boolean" ? raw.retryable : false,
      );
    }
  }

  return new OAuthConnectorCommandError(
    "unexpected",
    "Couldn't complete OAuth for this connector.",
    false,
  );
}

export async function connectOAuthConnector(
  input: ConnectOAuthConnectorInput,
): Promise<ConnectOAuthConnectorResult> {
  try {
    return await invoke<ConnectOAuthConnectorResult>("connect_oauth_connector", {
      input: {
        connectionId: input.connectionId,
        serverUrl: input.serverUrl,
      },
    });
  } catch (error) {
    throw normalizeOAuthCommandError(error);
  }
}

export async function cancelOAuthConnectorConnect(
  connectionId: string,
): Promise<void> {
  try {
    await invoke("cancel_oauth_connector_connect", { connectionId });
  } catch (error) {
    throw normalizeOAuthCommandError(error);
  }
}

export async function getOAuthConnectorBundleState(
  connectionId: string,
): Promise<ConnectorOAuthBundleState> {
  try {
    return await invoke<ConnectorOAuthBundleState>("get_oauth_connector_bundle_state", {
      connectionId,
    });
  } catch (error) {
    throw normalizeOAuthCommandError(error);
  }
}

export async function getValidOAuthAccessToken(
  input: GetValidOAuthAccessTokenInput,
): Promise<GetValidOAuthAccessTokenResult> {
  try {
    return await invoke<GetValidOAuthAccessTokenResult>("get_valid_oauth_access_token", {
      input: {
        connectionId: input.connectionId,
        minRemainingSeconds: input.minRemainingSeconds,
      },
    });
  } catch (error) {
    throw normalizeOAuthCommandError(error);
  }
}

export async function deleteOAuthConnectorBundle(
  connectionId: string,
): Promise<void> {
  try {
    await invoke("delete_oauth_connector_bundle", { connectionId });
  } catch (error) {
    throw normalizeOAuthCommandError(error);
  }
}
