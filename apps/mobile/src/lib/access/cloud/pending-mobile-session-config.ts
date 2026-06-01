import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import {
  assertCommandAccepted,
  assertCommandEnqueued,
  configApplyState,
  waitForCommandTerminal,
} from "./pending-mobile-command-status";
import { assertStillCurrent } from "./pending-mobile-prompt-polling";
import type {
  EnqueueCloudCommand,
  UpdateSessionConfigPayload,
} from "./pending-mobile-prompt-types";

export async function applyPendingSessionConfigUpdates(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection;
  pendingPrompt: MobilePendingPrompt;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<void> {
  const updates = filterSessionConfigUpdatesForSession(
    args.pendingPrompt.sessionConfigUpdates ?? [],
    args.session,
  );
  if (updates.length === 0) {
    return;
  }
  args.onStatus("Applying session configuration.");
  for (const update of updates) {
    assertStillCurrent(args.shouldContinue);
    const command = await args.enqueueConfig({
      idempotencyKey: `${args.pendingPrompt.id}:config:${update.configId}`,
      targetId: args.session.targetId,
      workspaceId: args.session.workspaceId,
      cloudWorkspaceId: args.workspace.id,
      sessionId: args.session.sessionId,
      kind: "update_session_config",
      source: "mobile",
      payload: update,
    });
    args.setLatestCommandId(command.commandId);
    assertCommandEnqueued(command);
    const completed = await waitForCommandTerminal(
      command.commandId,
      args.client,
      args.shouldContinue,
      args.onStatus,
    );
    assertCommandAccepted(completed);
    const applyState = configApplyState(completed);
    if (applyState && applyState !== "applied") {
      throw new Error("Session configuration was queued but not applied.");
    }
  }
}

function filterSessionConfigUpdatesForSession(
  updates: UpdateSessionConfigPayload[],
  session: CloudSessionProjection,
): UpdateSessionConfigPayload[] {
  const supportedConfigIds = collectSupportedSessionConfigIds(session);
  if (supportedConfigIds.size === 0) {
    return [];
  }
  return updates.filter((update) => supportedConfigIds.has(update.configId));
}

function collectSupportedSessionConfigIds(session: CloudSessionProjection): Set<string> {
  const supported = new Set<string>();
  const liveConfig = objectFromUnknown((session as unknown as Record<string, unknown>).liveConfig);
  const rawOptions = Array.isArray(liveConfig?.rawConfigOptions)
    ? liveConfig.rawConfigOptions
    : [];
  for (const option of rawOptions) {
    const id = nestedString(option, "id");
    if (id) {
      supported.add(id);
    }
  }
  const controls = objectFromUnknown(liveConfig?.normalizedControls);
  if (controls) {
    for (const control of Object.values(controls)) {
      const rawConfigId = nestedString(control, "rawConfigId");
      if (rawConfigId) {
        supported.add(rawConfigId);
      }
    }
  }
  return supported;
}

function nestedString(value: unknown, key: string): string | null {
  const object = objectFromUnknown(value);
  if (!object) return null;
  const nested = object[key];
  return typeof nested === "string" ? nested : null;
}

function objectFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return objectFromUnknown(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
