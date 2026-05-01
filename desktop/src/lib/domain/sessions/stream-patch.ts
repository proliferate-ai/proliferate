import type {
  InteractionPayload,
  PendingInteractionPayloadSummary,
  SessionEventEnvelope,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";

export interface SessionStreamPatchInput {
  slot: {
    modelId: string | null;
    modeId: string | null;
    title: string | null;
    status: SessionStatus | null;
    executionSummary?: SessionExecutionSummary | null;
  };
  nextTranscript: TranscriptState;
  envelope: SessionEventEnvelope;
}

export interface SessionStreamPatch {
  transcript: TranscriptState;
  liveConfig?: SessionLiveConfigSnapshot | null;
  executionSummary?: SessionExecutionSummary | null;
  modelId?: string | null;
  modeId?: string | null;
  title?: string | null;
  status?: SessionStatus | null;
}

export interface SessionStreamBatchPatchInput {
  slot: SessionStreamPatchInput["slot"];
  nextTranscript: TranscriptState;
  envelopes: SessionEventEnvelope[];
}

export function buildSessionStreamPatch({
  slot,
  nextTranscript,
  envelope,
}: SessionStreamPatchInput): SessionStreamPatch {
  const event = envelope.event;
  const patch: SessionStreamPatch = {
    transcript: nextTranscript,
  };
  const currentPendingInteractions = slot.executionSummary?.pendingInteractions ?? [];

  if (event.type === "current_mode_update") {
    patch.modeId = event.currentModeId;
  }

  if (event.type === "config_option_update") {
    patch.liveConfig = event.liveConfig;
    patch.modelId =
      event.liveConfig.normalizedControls.model?.currentValue ?? slot.modelId;
    patch.modeId =
      event.liveConfig.normalizedControls.mode?.currentValue ?? slot.modeId;
    patch.transcript = {
      ...nextTranscript,
      currentModeId:
        event.liveConfig.normalizedControls.mode?.currentValue
        ?? nextTranscript.currentModeId,
    };
  }

  if (event.type === "session_info_update" && event.title !== undefined) {
    patch.title = event.title ?? null;
  }

  if (
    event.type === "turn_started"
    || event.type === "item_started"
    || event.type === "item_delta"
  ) {
    patch.status = "running";
    patch.executionSummary = {
      phase: "running",
      hasLiveHandle: true,
      pendingInteractions: currentPendingInteractions,
      updatedAt: envelope.timestamp,
    };
  }

  if (event.type === "interaction_requested") {
    patch.status = "running";
    patch.executionSummary = {
      phase: "awaiting_interaction",
      hasLiveHandle: true,
      pendingInteractions: [
        ...currentPendingInteractions.filter((entry) => entry.requestId !== event.requestId),
        {
          requestId: event.requestId,
          kind: event.kind,
          title: event.title,
          description: event.description ?? null,
          source: {
            toolCallId: event.source.toolCallId ?? null,
            toolKind: event.source.toolKind ?? null,
            toolStatus: event.source.toolStatus ?? null,
            linkedPlanId: event.source.linkedPlanId ?? null,
          },
          payload: summarizeInteractionPayload(event.payload),
        },
      ],
      updatedAt: envelope.timestamp,
    };
  }

  if (event.type === "interaction_resolved") {
    patch.status = "running";
    patch.executionSummary = {
      phase: "running",
      hasLiveHandle: true,
      pendingInteractions: currentPendingInteractions.filter((entry) => entry.requestId !== event.requestId),
      updatedAt: envelope.timestamp,
    };
  }

  if (event.type === "turn_ended" || event.type === "error") {
    patch.status = event.type === "error" ? "errored" : "idle";
    patch.executionSummary = {
      phase: event.type === "error" ? "errored" : "idle",
      hasLiveHandle: true,
      pendingInteractions: [],
      updatedAt: envelope.timestamp,
    };
  }

  if (event.type === "session_ended") {
    patch.status = event.reason === "error" ? "errored" : "closed";
    patch.executionSummary = {
      phase: event.reason === "error" ? "errored" : "closed",
      hasLiveHandle: false,
      pendingInteractions: [],
      updatedAt: envelope.timestamp,
    };
  }

  return patch;
}

export function buildSessionStreamBatchPatch({
  slot,
  nextTranscript,
  envelopes,
}: SessionStreamBatchPatchInput): SessionStreamPatch {
  const patch: SessionStreamPatch = {
    transcript: nextTranscript,
  };
  let foldedSlot: SessionStreamPatchInput["slot"] = slot;

  for (const envelope of envelopes) {
    const eventPatch = buildSessionStreamPatch({
      slot: foldedSlot,
      nextTranscript,
      envelope,
    });
    Object.assign(patch, eventPatch);
    foldedSlot = {
      modelId:
        eventPatch.modelId !== undefined
          ? eventPatch.modelId
          : foldedSlot.modelId,
      modeId:
        eventPatch.modeId !== undefined
          ? eventPatch.modeId
          : foldedSlot.modeId,
      title:
        eventPatch.title !== undefined
          ? eventPatch.title
          : foldedSlot.title,
      status:
        eventPatch.status !== undefined
          ? eventPatch.status
          : foldedSlot.status,
      executionSummary:
        eventPatch.executionSummary !== undefined
          ? eventPatch.executionSummary
          : foldedSlot.executionSummary,
    };
  }

  patch.transcript = nextTranscript;
  return patch;
}

function summarizeInteractionPayload(
  payload: InteractionPayload,
): PendingInteractionPayloadSummary {
  if (payload.type === "user_input") {
    return {
      type: "user_input",
      questions: payload.questions ?? [],
    };
  }
  if (payload.type === "mcp_elicitation") {
    return {
      type: "mcp_elicitation",
      serverName: payload.serverName,
      mode: payload.mode,
    };
  }
  return {
    type: "permission",
    options: payload.type === "permission" ? payload.options ?? [] : [],
    context: payload.type === "permission" ? payload.context ?? null : null,
  };
}
