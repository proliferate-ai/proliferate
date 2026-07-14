import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { AuthMethod } from "@proliferate/product-domain/auth/model";

import type { DesktopBridge } from "./desktop-bridge";

/**
 * The one host contract. Desktop and Web each construct a single ProductHost
 * value and pass it to {@link ProductHostProvider}. ProductClient reads shared
 * product capabilities through this object; the two hosts differ only in how
 * each capability is implemented.
 *
 * ProductHost is an immutable reactive snapshot, not a mutable service bag.
 * A host must provide a new ProductHost object whenever deployment, auth, or
 * Cloud-client state changes. ProductHostProvider intentionally preserves the
 * supplied object's identity so normal React context propagation handles those
 * replacements without hidden subscriptions or cloning.
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
 * Why an anonymous state is being shown. Normalizes the existing Desktop and
 * Web gate failures — an unreachable deployment, a server-declared access
 * denial (e.g. beta gating), or a normalized auth-callback failure — without
 * introducing new product policy.
 */
export type ProductAuthIssue =
  | { kind: "deployment_unreachable" }
  | { kind: "access_denied"; code: string }
  | {
      kind: "callback_failed";
      reason:
        | "provider_error"
        | "malformed_callback"
        | "state_mismatch"
        | "expired"
        | "exchange_failed"
        | "already_consumed";
      providerCode?: string;
    };

/**
 * Whether an authenticated identity can use the product yet. `action_required`
 * mirrors the existing Web gate that blocks until GitHub is connected.
 */
export type ProductAuthReadiness =
  | { status: "ready" }
  | { status: "action_required"; action: "connect_github" };

/**
 * Normalized authentication state. The transport differs per host, but the
 * shared login UI reads the same state shape on both.
 */
export type AuthState =
  | { status: "loading" }
  | {
      status: "anonymous";
      methods: AuthMethod[];
      /** Present when anonymity is the result of a failure, not a fresh gate. */
      issue?: ProductAuthIssue;
    }
  | {
      status: "authenticated";
      /**
       * The normalized identity, or `null` during the existing Desktop
       * cached-session degraded path where the session is trusted but the
       * user record has not been (re)fetched.
       */
      user: ProductAuthUser | null;
      readiness: ProductAuthReadiness;
    };

/**
 * A shared login intent. Password completes in `startLogin`; provider flows
 * complete out of band and resume through `finishLogin`. SSO carries the
 * organization/connection/slug inputs the login screen collects; every method
 * exposed by {@link AuthMethod} (including Apple) can be started.
 */
export type LoginRequest =
  | { kind: "password"; email: string; password: string }
  | {
      kind: "github";
      purpose?: ProductProviderAuthPurpose;
      prompt?: "select_account";
    }
  | {
      kind: "google";
      purpose?: ProductProviderAuthPurpose;
      prompt?: "select_account";
    }
  | {
      kind: "apple";
      purpose?: ProductProviderAuthPurpose;
      prompt?: "select_account";
    }
  | {
      kind: "sso";
      email?: string;
      organizationId?: string;
      connectionId?: string;
      slug?: string;
    };

/** Why an external identity-provider flow is being started. */
export type ProductProviderAuthPurpose =
  | "login"
  | "link"
  | "required_github_link";

/**
 * Host-decoded provider callback, already normalized to success or failure by
 * the host before `finishLogin`. The raw callback URL, PKCE verifier, and
 * OAuth state proof never cross this boundary. This value is ephemeral:
 * ProductClient never persists it, puts it in route state, or sends its
 * code/state to telemetry.
 */
export type AuthCallback =
  | { status: "success"; code: string; state?: string }
  | { status: "failure"; code: string; state?: string };

/**
 * The shared authentication operations. ProductClient owns the auth gate and
 * screens; each host implements the transport behind these methods. This
 * package defines the contract only and implements neither host.
 */
export interface ProductAuthHost {
  /** False only when this host deliberately permits local anonymous use. */
  authRequired: boolean;
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
 * Ordered query parameters as decoded key/value pairs. This is deliberately not
 * a `Record`, `Map`, or object: it preserves the exact order of the incoming
 * query string and keeps every duplicate key (`x=1&x=2` decodes to two pairs).
 * Decoders build it with `Array.from(url.searchParams.entries())`; encoders
 * append every pair in order. Implementations must never route these through
 * `Object.fromEntries`, `URLSearchParams.set`, or any conversion that collapses
 * repeated keys. Exact percent-encoding bytes need not survive, but decoded
 * values, their order, and duplicates must.
 */
export type ProductQueryParams = readonly (readonly [
  key: string,
  value: string,
])[];

/**
 * Lossless location state carried by every {@link ProductEntry}. Empty fields
 * are omitted rather than stored as empty values. The fragment is stored
 * without its leading `#` and encoded with exactly one `#` on output.
 */
export interface ProductLocationState {
  /** Ordered, duplicate-preserving query pairs. Omitted when empty. */
  query?: ProductQueryParams;
  /** URL fragment without the leading `#`. Omitted when absent. */
  fragment?: string;
}

export type ProductSettingsEntrySection =
  | "account"
  | "billing"
  | "environments"
  | "general"
  | "integrations"
  | "organization";

/**
 * The destination discriminant of a normalized inbound entry, independent of
 * its query/fragment location state. Compose with {@link ProductLocationState}
 * to form a {@link ProductEntry}.
 */
export type ProductEntryDestination =
  | {
      kind: "workspace";
      workspaceId: string;
    }
  | { kind: "workflow"; workflowId: string }
  | { kind: "invitation"; token: string }
  | {
      kind: "organization-join";
      organizationId: string;
      /**
       * Optional issuing deployment. The host must validate and normalize this
       * origin before constructing the entry (HTTPS, with HTTP allowed only for
       * loopback development, and never embedded credentials).
       */
      serverOrigin?: string;
    }
  | {
      kind: "integration-callback";
      source: "integration_oauth_callback" | "mcp_oauth_callback";
      status?: "completed" | "failed";
      flowId?: string;
      failureCode?: string;
    }
  | {
      kind: "billing-return";
      status: "success" | "cancel" | "done";
    }
  | {
      kind: "settings";
      section: ProductSettingsEntrySection;
      source?: "github_app_callback";
    };

/**
 * A normalized inbound destination. Each host decodes its raw URL
 * (`https://...` on Web, `proliferate://...` on Desktop) into this shape, always
 * carrying lossless query/fragment location state.
 */
export type ProductEntry = ProductEntryDestination & ProductLocationState;

/**
 * External-link, Desktop-handoff, and inbound-deep-link transport. Internal
 * routing is shared and owned by ProductClient; only host transport differs.
 */
export interface ProductLinks {
  openExternal(url: string): Promise<void>;
  openInDesktop?: (entry: ProductEntry) => Promise<void>;
  /**
   * Encode a normalized product destination as the host-specific callback URL
   * supplied to Cloud mutations (HTTPS on Web, a Desktop deep link on Desktop).
   */
  buildReturnUrl(entry: ProductEntry): string;
  /**
   * Deliver host-decoded inbound entries (initial + live) to shared routing;
   * returns an unsubscribe function. "Initial + live" is bounded: the listener
   * receives the host's current snapshot at subscription time (e.g. the deep
   * link the process launched with) plus every entry that arrives after it
   * subscribes. It does not replay live events that arrived before this
   * listener mounted, and the host keeps no persistence or queue. This is how
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
  extras?: Record<string, unknown>;
  level?: "fatal" | "error" | "warning" | "log" | "info" | "debug";
  fingerprint?: string[];
}

export interface ProductSupportTelemetryRefs {
  posthogDistinctId?: string;
  posthogSessionId?: string;
  sentryEventIds?: string[];
}

export interface ProductSupportTelemetryContext {
  clientReleaseId: string;
  telemetryRefs?: ProductSupportTelemetryRefs;
}

/**
 * A route change already classified by product code. ProductClient owns the
 * route taxonomy: it resolves the concrete product `routeId` and passes it
 * alongside the raw `pathname` so the host attaches vendor navigation metadata
 * without re-classifying (or re-emitting a product screen-view) itself. The
 * concrete route-id union stays product-owned; this open boundary carries its
 * value as a string.
 */
export interface ProductRouteChange {
  pathname: string;
  routeId: string;
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
  setTag(key: string, value: string): void;
  /**
   * Host-owned route instrumentation. ProductClient calls this after shared
   * routing settles, passing the already-classified {@link ProductRouteChange};
   * the host may attach vendor tracing and route metadata but must not
   * re-classify the pathname or emit a second product screen-view event.
   */
  routeChanged(change: ProductRouteChange): void;
  /** Release/correlation metadata attached to support-report submissions. */
  getSupportContext(): ProductSupportTelemetryContext;
}
