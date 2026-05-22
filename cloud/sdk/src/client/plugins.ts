import { getProliferateClient } from "./core.js";
import type {
  CloudPluginConfiguredItem,
  CloudPluginConfiguredItemsResponse,
  PatchPluginConfiguredItemRequest,
} from "../types/index.js";

export async function listConfiguredPlugins(): Promise<CloudPluginConfiguredItemsResponse> {
  return (await getProliferateClient().GET("/v1/cloud/plugins")).data!;
}

export async function installConfiguredPlugin(
  pluginId: string,
): Promise<CloudPluginConfiguredItem> {
  return (await getProliferateClient().POST("/v1/cloud/plugins/{plugin_id}/install", {
    params: { path: { plugin_id: pluginId } },
  })).data!;
}

export async function patchConfiguredPlugin(
  itemId: string,
  body: PatchPluginConfiguredItemRequest,
): Promise<CloudPluginConfiguredItem> {
  return (await getProliferateClient().PATCH("/v1/cloud/plugins/{item_id}", {
    params: { path: { item_id: itemId } },
    body,
  })).data!;
}

export async function uninstallConfiguredPlugin(itemId: string): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/plugins/{item_id}", {
    params: { path: { item_id: itemId } },
  });
}
