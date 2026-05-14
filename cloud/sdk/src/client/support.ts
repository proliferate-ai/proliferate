import { getProliferateClient } from "./core.js";
import type { SendSupportMessageRequest, SupportMessageContext } from "../types/index.js";

export type { SupportMessageContext, SendSupportMessageRequest };

export async function sendSupportMessage(input: SendSupportMessageRequest): Promise<void> {
  await getProliferateClient().POST("/v1/support/messages", { body: input });
}
