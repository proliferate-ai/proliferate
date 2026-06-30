import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  CloudSkillConfiguredItem,
  CloudSkillConfiguredItemsResponse,
  CreateSkillConfiguredItemRequest,
  PatchSkillConfiguredItemRequest,
} from "../types/index.js";

export async function listConfiguredSkills(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSkillConfiguredItemsResponse> {
  return (await legacyOpenApiClient(client).GET("/v1/cloud/skills")).data!;
}

export async function createConfiguredSkill(
  body: CreateSkillConfiguredItemRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSkillConfiguredItem> {
  return (await legacyOpenApiClient(client).POST("/v1/cloud/skills", { body })).data!;
}

export async function patchConfiguredSkill(
  itemId: string,
  body: PatchSkillConfiguredItemRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSkillConfiguredItem> {
  return (await legacyOpenApiClient(client).PATCH("/v1/cloud/skills/{item_id}", {
    params: { path: { item_id: itemId } },
    body,
  })).data!;
}

export async function deleteConfiguredSkill(
  itemId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await legacyOpenApiClient(client).DELETE("/v1/cloud/skills/{item_id}", {
    params: { path: { item_id: itemId } },
  });
}
