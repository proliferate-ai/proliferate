import type {
  ProductEntry,
  ProductLocationState,
  ProductQueryParams,
} from "@proliferate/product-client/host/product-host";

const ROUTE_OWNED_QUERY_KEYS = [
  "section",
  "checkout",
  "source",
  "status",
  "flowId",
  "failureCode",
  "joinOrganizationId",
  "joinServerOrigin",
] as const;

type RouteOwnedQueryKey = (typeof ROUTE_OWNED_QUERY_KEYS)[number];
type RouteQueryOverrides = Partial<Record<RouteOwnedQueryKey, string | null>>;
type RouteQueryDefaults = Partial<Record<RouteOwnedQueryKey, string | null>>;

/**
 * Map a normalized product entry to the shared in-app route. Keys overridden
 * by this destination are canonicalized to one value; every other query pair
 * keeps its decoded order, duplicates, empty values, and Unicode content.
 */
export function productEntryRoute(entry: ProductEntry): string | null {
  switch (entry.kind) {
    case "home":
      return buildProductRoute("/", entry);
    case "workspace":
      return buildProductRoute(
        `/workspaces/${encodeURIComponent(entry.workspaceId)}`,
        entry,
      );
    case "workflow":
      return buildProductRoute(
        `/workflows/${encodeURIComponent(entry.workflowId)}`,
        entry,
      );
    case "invitation":
      // There is no active product producer/consumer for this parked variant.
      return null;
    case "organization-join":
      return buildProductRoute("/settings", entry, {
        section: "account",
        joinOrganizationId: entry.organizationId,
        joinServerOrigin: entry.serverOrigin ?? null,
      });
    case "integration-callback":
      return buildProductRoute("/settings", entry, {
        section: "integrations",
      }, {
        source: entry.source,
        status: entry.status ?? null,
        flowId: entry.flowId ?? null,
        failureCode: entry.failureCode ?? null,
      });
    case "billing-return":
      return buildProductRoute("/settings", entry, {
        checkout: entry.status,
        section: "billing",
      });
    case "settings":
      return buildProductRoute("/settings", entry, {
        section: entry.section,
      }, {
        source: entry.source ?? null,
      });
  }
}

function buildProductRoute(
  pathname: string,
  location: ProductLocationState,
  overrides: RouteQueryOverrides = {},
  defaults: RouteQueryDefaults = {},
): string {
  const params = queryToParams(location.query);

  // Only this destination's typed fields own their matching query keys.
  // Reserved names used by other destinations remain ordinary, lossless
  // ordered pairs here.
  for (const [key, value] of Object.entries(overrides) as Array<[
    RouteOwnedQueryKey,
    string | null,
  ]>) {
    setCanonicalParam(params, key, value);
  }

  // Callback payload fields already present in the host-decoded query stay
  // lossless, including duplicate values. Typed fields fill a missing key and
  // win only if a host constructs an internally inconsistent entry.
  for (const [key, value] of Object.entries(defaults) as Array<[
    RouteOwnedQueryKey,
    string | null,
  ]>) {
    ensureTypedParam(params, key, value);
  }

  const search = params.toString();
  const hash = location.fragment
    ? `#${encodeURIComponent(location.fragment)}`
    : "";
  return `${pathname}${search ? `?${search}` : ""}${hash}`;
}

function queryToParams(query?: ProductQueryParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of query ?? []) {
    params.append(key, value);
  }
  return params;
}

function setCanonicalParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value === null) {
    params.delete(key);
    return;
  }
  params.set(key, value);
}

function ensureTypedParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value === null) {
    return;
  }
  const current = params.get(key);
  if (current === null) {
    params.append(key, value);
    return;
  }
  if (current !== value) {
    params.set(key, value);
  }
}
