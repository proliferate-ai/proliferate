import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
} from "../types/index.js";

export async function enqueueCommand<TPayload>(
  command: CloudCommandEnvelope<TPayload>,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudCommandResponse> {
  return client.requestJson<CloudCommandResponse>({
    method: "POST",
    path: "/v1/cloud/commands",
    body: command,
  });
}

export async function getCommandStatus(
  commandId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudCommandResponse> {
  return client.requestJson<CloudCommandResponse>({
    method: "GET",
    path: "/v1/cloud/commands/{command_id}",
    pathParams: { command_id: commandId },
  });
}
