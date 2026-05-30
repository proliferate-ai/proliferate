import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudPluginConfiguredItem,
  CloudPluginConfiguredItemsResponse,
  PatchPluginConfiguredItemRequest,
} from "../types/index.js";

export async function listConfiguredPlugins(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudPluginConfiguredItemsResponse> {
  return (await client.GET("/v1/cloud/plugins")).data!;
}

export async function installConfiguredPlugin(
  pluginId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudPluginConfiguredItem> {
  return (await client.POST("/v1/cloud/plugins/{plugin_id}/install", {
    params: { path: { plugin_id: pluginId } },
  })).data!;
}

export async function patchConfiguredPlugin(
  itemId: string,
  body: PatchPluginConfiguredItemRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudPluginConfiguredItem> {
  return (await client.PATCH("/v1/cloud/plugins/{item_id}", {
    params: { path: { item_id: itemId } },
    body,
  })).data!;
}

export async function uninstallConfiguredPlugin(
  itemId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.DELETE("/v1/cloud/plugins/{item_id}", {
    params: { path: { item_id: itemId } },
  });
}
