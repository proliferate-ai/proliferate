import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  CloudPluginConfiguredItem,
  CloudPluginConfiguredItemsResponse,
  PatchPluginConfiguredItemRequest,
} from "../types/index.js";

export async function listConfiguredPlugins(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudPluginConfiguredItemsResponse> {
  return (await legacyOpenApiClient(client).GET("/v1/cloud/plugins")).data!;
}

export async function installConfiguredPlugin(
  pluginId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudPluginConfiguredItem> {
  return (await legacyOpenApiClient(client).POST("/v1/cloud/plugins/{plugin_id}/install", {
    params: { path: { plugin_id: pluginId } },
  })).data!;
}

export async function patchConfiguredPlugin(
  itemId: string,
  body: PatchPluginConfiguredItemRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudPluginConfiguredItem> {
  return (await legacyOpenApiClient(client).PATCH("/v1/cloud/plugins/{item_id}", {
    params: { path: { item_id: itemId } },
    body,
  })).data!;
}

export async function uninstallConfiguredPlugin(
  itemId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await legacyOpenApiClient(client).DELETE("/v1/cloud/plugins/{item_id}", {
    params: { path: { item_id: itemId } },
  });
}
