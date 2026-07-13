import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { AuthMethod } from "@proliferate/product-domain/auth/model";

import type { DesktopBridge } from "./desktop-bridge";

/**
 * The one host contract. Desktop and Web each construct a single ProductHost
 * value and pass it to {@link ProductHostProvider}. ProductClient reads shared
 * product capabilities through this object; the two hosts differ only in how
 * each capability is implemented.
 *
 * There is one provider, not a provider tree per capability. Product behavior
 * should normally check a real capability (especially `desktop !== null`)
 * rather than branching on `surface`.
 */
export interface ProductHost {
  /** Descriptive surface marker. Prefer capability checks over reading this. */
  surface: "desktop" | "web";

  deployment: ProductDeploymentHost;
  auth: ProductAuthHost;

  cloud: {
    /** Authenticated Cloud client, or null before an authority is resolved. */
    client: ProliferateCloudClient | null;
  };

  storage: ProductStorage;
  links: ProductLinks;
  clipboard: ProductClipboard;
  telemetry: ProductTelemetry;

  /** A real Desktop bridge, or null on Web and other non-Desktop hosts. */
  desktop: DesktopBridge | null;
}

/**
 * API selection. Hosted Web receives one configured base URL; Desktop may
 * optionally switch to another deployment for self-hosting and reset back to
 * its default server. This is distinct from local AnyHarness access, which is a
 * Desktop bridge capability.
 */
export interface ProductDeploymentHost {
  apiBaseUrl: string;
  /** Desktop-only: point the product at a different deployment. */
  switchDeployment?: (apiBaseUrl: string) => Promise<void>;
  /** Desktop-only: return to the host's built-in default deployment. */
  resetDeployment?: () => Promise<void>;
}

/**
 * The authenticated product identity. Richer than `product-domain`'s minimal
 * chat `ProductUser`: it carries the account fields Desktop already surfaces
 * (email, avatar, GitHub login) so account/settings/telemetry consumers do not
 * lose data through the host boundary.
 */
export interface ProductAuthUser {
  id: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  githubLogin?: string | null;
}

/**
 * Normalized authentication state. The transport differs per host, but the
 * shared login UI reads the same state shape on both.
 */
export type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; methods: AuthMethod[] }
  | { status: "authenticated"; user: ProductAuthUser };

/**
 * A shared login intent. Password completes in `startLogin`; provider flows
 * complete out of band and resume through `finishLogin`. SSO carries the
 * organization/connection/slug inputs the login screen collects; every method
 * exposed by {@link AuthMethod} (including Apple) can be started.
 */
export type LoginRequest =
  | { kind: "password"; email: string; password: string }
  | { kind: "github" }
  | { kind: "google" }
  | { kind: "apple" }
  | {
      kind: "sso";
      email?: string;
      organizationId?: string;
      connection?: string;
      slug?: string;
    };

/** Host-decoded provider callback. The raw callback URL and OAuth/PKCE state
 * never cross this boundary. */
export interface AuthCallback {
  code: string;
  state?: string;
}

/**
 * The shared authentication operations. ProductClient owns the auth gate and
 * screens; each host implements the transport behind these methods. This
 * package defines the contract only and implements neither host.
 */
export interface ProductAuthHost {
  state: AuthState;

  restoreSession(): Promise<void>;
  startLogin(request: LoginRequest): Promise<void>;
  finishLogin(callback: AuthCallback): Promise<void>;
  /** Abandon an in-flight provider/OAuth login before it completes. */
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
}

/**
 * Non-secret, device-local product state (appearance, drafts, recent
 * selections). Must never hold login credentials, provider API keys, SSH
 * credentials, or PKCE secrets.
 */
export interface ProductStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * A normalized inbound destination. Each host decodes its raw URL
 * (`https://...` on Web, `proliferate://...` on Desktop) into this shape.
 */
export type ProductEntry =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "workflow"; workflowId: string }
  | { kind: "invitation"; token: string }
  | { kind: "billing-return" };

/**
 * External-link, Desktop-handoff, and inbound-deep-link transport. Internal
 * routing is shared and owned by ProductClient; only host transport differs.
 */
export interface ProductLinks {
  openExternal(url: string): Promise<void>;
  openInDesktop?: (entry: ProductEntry) => Promise<void>;
  /**
   * Deliver host-decoded inbound entries (initial + live) to shared routing.
   * The listener receives any entry that arrived before subscription as well
   * as every subsequent one; returns an unsubscribe function. This is how
   * Desktop OS deep links and Web callback entries reach ProductClient.
   */
  observeInboundEntries(listener: (entry: ProductEntry) => void): () => void;
}

export interface ProductClipboard {
  writeText(value: string): Promise<void>;
}

/** A shared product telemetry event. Kept open at this layer; the concrete
 * event catalog is owned by the emitting product code. */
export interface ProductEvent {
  name: string;
  properties?: Record<string, unknown>;
}

/** Non-secret context attached to a captured exception. */
export interface ErrorContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Shared product telemetry. ProductClient emits the same events on both hosts;
 * each host constructs the implementation (Sentry/PostHog/native diagnostics)
 * and owns vendor lifecycle. ProductClient imports no vendor SDK directly.
 */
export interface ProductTelemetry {
  track(event: ProductEvent): void;
  captureException(error: unknown, context?: ErrorContext): void;
  setUser(user: ProductAuthUser | null): void;
}
