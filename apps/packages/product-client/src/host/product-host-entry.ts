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
