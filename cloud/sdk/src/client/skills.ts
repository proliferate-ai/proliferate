import { getProliferateClient } from "./core.js";
import type {
  CloudSkillConfiguredItem,
  CloudSkillConfiguredItemsResponse,
  CreateSkillConfiguredItemRequest,
  PatchSkillConfiguredItemRequest,
} from "../types/index.js";

export async function listConfiguredSkills(): Promise<CloudSkillConfiguredItemsResponse> {
  return (await getProliferateClient().GET("/v1/cloud/skills")).data!;
}

export async function createConfiguredSkill(
  body: CreateSkillConfiguredItemRequest,
): Promise<CloudSkillConfiguredItem> {
  return (await getProliferateClient().POST("/v1/cloud/skills", { body })).data!;
}

export async function patchConfiguredSkill(
  itemId: string,
  body: PatchSkillConfiguredItemRequest,
): Promise<CloudSkillConfiguredItem> {
  return (await getProliferateClient().PATCH("/v1/cloud/skills/{item_id}", {
    params: { path: { item_id: itemId } },
    body,
  })).data!;
}

export async function deleteConfiguredSkill(itemId: string): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/skills/{item_id}", {
    params: { path: { item_id: itemId } },
  });
}
