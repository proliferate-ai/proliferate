import { useMemo } from "react";
import type { NativeIntegrationRisk, NativeIntegrationsResponse } from "@anyharness/sdk";
import { useNativeIntegrationsQuery } from "#product/hooks/access/anyharness/agents/use-native-integrations-query";

/**
 * Which pieces of the user's own harness installation are on offer, as
 * render-ready rows for the "From your <Harness> setup" settings section.
 * Owner spec: `specs/systems/harnesses/native-integrations.md`, "Settings
 * surface". The wire read lives in the access layer
 * (`use-native-integrations-query`); this hook only shapes it for rendering:
 * bundles first, stale selections appended as Missing rows, icon namespaces
 * resolved.
 */

/**
 * Curated bundles carry a Proliferate-drawn glyph registered in
 * `IntegrationIcon` under these namespaces. Raw `mcp:*` rows keep their full
 * prefixed id as the namespace ON PURPOSE: it can never collide with a
 * registered brand namespace, so a user-typed server name like "linear" falls
 * through to the Plug fallback instead of painting the wrong company's logo
 * (spec, "Icons").
 */
const BUNDLE_ICON_NAMESPACES: Record<string, string> = {
  "bundle:computer-use": "computer-use",
  "bundle:chrome": "chrome-browser-use",
  "bundle:claude-chrome": "claude-in-chrome",
};

export interface NativeIntegrationRow {
  id: string;
  displayName: string;
  /** Description when the entry has one, else the config-file origin. */
  secondary: string | null;
  /** True when `secondary` is a config path/origin, rendered in mono. */
  secondaryIsSource: boolean;
  /** `IntegrationIcon` namespace: a bundle glyph, or a Plug-fallback id. */
  iconNamespace: string;
  isBundle: boolean;
  risk: NativeIntegrationRisk;
  available: boolean;
  unavailableReason: string | null;
  enabled: boolean;
  /** An enabled selection whose config entry discovery no longer finds. */
  stale: boolean;
}

function toRow(
  integration: NativeIntegrationsResponse["integrations"][number],
): NativeIntegrationRow {
  return {
    id: integration.id,
    displayName: integration.displayName,
    secondary: integration.description ?? integration.source ?? null,
    secondaryIsSource: !integration.description && !!integration.source,
    iconNamespace: BUNDLE_ICON_NAMESPACES[integration.id] ?? integration.id,
    isBundle: integration.kind === "bundle",
    risk: integration.risk,
    available: integration.available,
    unavailableReason: integration.unavailableReason ?? null,
    enabled: integration.enabled,
    stale: false,
  };
}

/**
 * A stale selection has no discovered entry left to describe it — only its
 * id survives, so the row renders the bare server/bundle name with a Missing
 * badge and its toggle still on, so the user sees what to fix (spec,
 * "Settings surface").
 */
function toStaleRow(id: string): NativeIntegrationRow {
  const separator = id.indexOf(":");
  return {
    id,
    displayName: separator === -1 ? id : id.slice(separator + 1),
    secondary: null,
    secondaryIsSource: false,
    iconNamespace: BUNDLE_ICON_NAMESPACES[id] ?? id,
    isBundle: id.startsWith("bundle:"),
    risk: "none",
    available: false,
    unavailableReason: null,
    enabled: true,
    stale: true,
  };
}

export function useNativeIntegrations(harnessKind: string, enabled: boolean) {
  const query = useNativeIntegrationsQuery(harnessKind, enabled);

  const rows = useMemo<NativeIntegrationRow[]>(() => {
    const response = query.data;
    if (!response) return [];
    const discovered = response.integrations.map(toRow);
    return [
      // Bundles first (spec, "Settings surface"); server order within groups.
      ...discovered.filter((row) => row.isBundle),
      ...discovered.filter((row) => !row.isBundle),
      ...response.staleSelections.map(toStaleRow),
    ];
  }, [query.data]);

  return {
    rows,
    // A DISABLED query with no data is `status: "pending"` in v5; only
    // `fetchStatus` separates "in flight" from "not running and never will".
    isLoading: query.isPending && query.fetchStatus !== "idle",
    isError: query.isError,
    query,
  };
}
