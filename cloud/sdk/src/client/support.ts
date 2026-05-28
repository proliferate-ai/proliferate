import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { SendSupportMessageRequest, SupportMessageContext } from "../types/index.js";

export type { SupportMessageContext, SendSupportMessageRequest };

export async function sendSupportMessage(
  input: SendSupportMessageRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.POST("/v1/support/messages", { body: input });
}
