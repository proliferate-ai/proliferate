// Package-relative copy emitted by scripts/copy-product-client-assets.mjs from
// the repo-root catalogs/agents/catalog.json (gitignored; no checked-in duplicate).
import bundledAgentCatalogJson from "../../../generated/agent-catalog.json?raw";
import {
  projectCloudAgentCatalogToDesktopLaunchCatalog,
  type DesktopAgentLaunchCatalog,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import type {
  CloudAgentCatalogResponseInput,
  CloudAgentCatalogSettingInput,
} from "#product/lib/domain/agents/cloud-launch-catalog-types";

const BUNDLED_AGENT_CATALOG: CloudAgentCatalogResponseInput = JSON.parse(bundledAgentCatalogJson);

const BUNDLED_DESKTOP_AGENT_LAUNCH_CATALOG = projectCloudAgentCatalogToDesktopLaunchCatalog(
  BUNDLED_AGENT_CATALOG,
);

export function getBundledDesktopAgentLaunchCatalog(): DesktopAgentLaunchCatalog {
  return BUNDLED_DESKTOP_AGENT_LAUNCH_CATALOG;
}

/**
 * The harness-specific settings catalog.json declares for a harness
 * (`agents[].settings[]`), read from the bundled copy instead of a
 * re-literalled table (agent-auth.md FR-4: the catalog is the authority). Empty
 * for a harness that declares none.
 */
export function getBundledHarnessCatalogSettings(
  harnessKind: string,
): readonly CloudAgentCatalogSettingInput[] {
  const agent = BUNDLED_AGENT_CATALOG.agents.find((candidate) => candidate.kind === harnessKind);
  return agent?.settings ?? [];
}
