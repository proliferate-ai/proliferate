import bundledAgentCatalogJson from "../../../../../../catalogs/agents/v1/catalog.json?raw";
import {
  projectCloudAgentCatalogToDesktopLaunchCatalog,
  type DesktopAgentLaunchCatalog,
} from "./cloud-launch-catalog";

const BUNDLED_DESKTOP_AGENT_LAUNCH_CATALOG = projectCloudAgentCatalogToDesktopLaunchCatalog(
  JSON.parse(bundledAgentCatalogJson),
);

export function getBundledDesktopAgentLaunchCatalog(): DesktopAgentLaunchCatalog {
  return BUNDLED_DESKTOP_AGENT_LAUNCH_CATALOG;
}
