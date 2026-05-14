import { getProliferateClient } from "./core";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
} from "../types";

export async function enqueueCommand<TPayload>(
  command: CloudCommandEnvelope<TPayload>,
): Promise<CloudCommandResponse> {
  return getProliferateClient().requestJson<CloudCommandResponse>({
    method: "POST",
    path: "/v1/cloud/commands",
    body: command,
  });
}

export async function getCommandStatus(
  commandId: string,
): Promise<CloudCommandResponse> {
  return getProliferateClient().requestJson<CloudCommandResponse>({
    method: "GET",
    path: "/v1/cloud/commands/{command_id}",
    pathParams: { command_id: commandId },
  });
}

