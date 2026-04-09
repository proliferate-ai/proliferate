import { getProliferateClient } from "./client";
import type { SendSupportMessageRequest, SupportMessageContext } from "./client";

export type { SupportMessageContext, SendSupportMessageRequest };

export async function sendSupportMessage(input: SendSupportMessageRequest): Promise<void> {
  await getProliferateClient().POST("/v1/support/messages", { body: input });
}
