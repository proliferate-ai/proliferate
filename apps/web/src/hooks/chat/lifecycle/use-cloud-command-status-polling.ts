import { useEffect, useRef } from "react";
import {
  getCommandStatus,
  type CloudCommandResponse,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

export function useCloudCommandStatusPolling(input: {
  client: ProliferateCloudClient;
  commandIds: readonly string[];
  intervalMs: number;
  onCommands: (commands: readonly CloudCommandResponse[]) => void;
}) {
  const onCommandsRef = useRef(input.onCommands);
  onCommandsRef.current = input.onCommands;

  useEffect(() => {
    if (input.commandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollCommands = async () => {
      const commands: CloudCommandResponse[] = [];
      for (const commandId of input.commandIds) {
        try {
          commands.push(await getCommandStatus(commandId, input.client));
        } catch {
          // Keep polling other commands; transient status reads should not strand UI state.
        }
      }
      if (!active) {
        return;
      }
      onCommandsRef.current(commands);
      timeoutId = window.setTimeout(pollCommands, input.intervalMs);
    };

    timeoutId = window.setTimeout(pollCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [input.client, input.commandIds, input.intervalMs]);
}

export function useStableCommandIds(commandIds: readonly string[], key: string): readonly string[] {
  const stateRef = useRef({ commandIds, key });
  if (stateRef.current.key !== key) {
    stateRef.current = { commandIds, key };
  }
  return stateRef.current.commandIds;
}
