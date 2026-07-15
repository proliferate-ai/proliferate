// Package-relative copy emitted by scripts/copy-product-client-assets.mjs from
// the repo-root catalogs/agents/catalog.json (gitignored; no checked-in duplicate).
import bundledAgentCatalogJson from "../../../generated/agent-catalog.json?raw";
import {
  projectCloudAgentCatalogToDesktopLaunchCatalog,
  type DesktopAgentLaunchCatalog,
} from "#product/lib/domain/agents/cloud-launch-catalog";

const BUNDLED_DESKTOP_AGENT_LAUNCH_CATALOG = projectCloudAgentCatalogToDesktopLaunchCatalog(
  JSON.parse(bundledAgentCatalogJson),
);

export function getBundledDesktopAgentLaunchCatalog(): DesktopAgentLaunchCatalog {
  return BUNDLED_DESKTOP_AGENT_LAUNCH_CATALOG;
}
