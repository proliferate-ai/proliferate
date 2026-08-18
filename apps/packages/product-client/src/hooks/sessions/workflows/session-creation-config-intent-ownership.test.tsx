import type {
  AnyHarnessClient,
  NormalizedSessionControl,
  Session,
  SessionLiveConfigSnapshot,
  SetSessionConfigOptionResponse,
} from "@anyharness/sdk";
import { AnyHarnessError } from "@anyharness/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectNextDispatchableSessionIntent } from "#product/domain/sessions/intents/session-intent-selectors";
import { sessionIntentsForSession } from "#product/domain/sessions/intents/session-intent-state";
import { dispatchConfigIntent, type ConfigIntentDispatchDeps } from "#product/hooks/sessions/lifecycle/session-intent-config-dispatch";
import { materializeExistingSession } from "#product/hooks/sessions/workflows/session-creation-materialization-helpers";
import { publishCreatedSessionMaterialization } from "#product/hooks/sessions/workflows/session-creation-publication";
import type { SessionConfigModelRegistry } from "#product/lib/domain/chat/launch/session-config";
import { configValuesFromIntentSnapshot, planCreationConfigIntentSettlement,
  snapshotPreMaterializationConfigIntents } from "#product/lib/domain/sessions/creation/config-intent-settlement";
import { applySessionLaunchDefaults } from "#product/lib/workflows/sessions/session-launch-defaults";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { createEmptySessionRecord, putSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
const mocks = vi.hoisted(() => ({
  getSessionClientAndWorkspace: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.getSessionClientAndWorkspace,
}));
describe("session creation config-intent ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionIntentStore.getState().clear();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
  });

  it("settles two sessions from authoritative launch output before publication and dispatches only a newer live intent", async () => {
    const codex = strictConfigFixture({
      agentKind: "codex",
      applyState: "queued",
      currentValue: "low",
      modelId: "gpt-5.5",
      rawConfigId: "reasoning_effort",
      sessionId: "runtime-codex",
      values: ["low", "medium", "high", "max", "xhigh"],
    });
    const claude = strictConfigFixture({
      agentKind: "claude",
      applyState: "applied",
      currentValue: "low",
      modelId: "claude-fable-5",
      rawConfigId: "effort",
      sessionId: "runtime-claude",
      values: ["low", "medium", "high"],
    });
    putProjectedRecord("client-codex", "workspace-1", "codex", "gpt-5.5");
    putProjectedRecord("client-claude", "workspace-1", "claude", "claude-fable-5");
    const codexCaptured = enqueueEffort("client-codex", "reasoning_effort", "high");
    enqueueEffort("client-claude", "effort", "medium", "claude-old");
    enqueueEffort("client-claude", "effort", "high", "claude-latest");

    const codexSnapshot = snapshotFor("client-codex");
    const claudeSnapshot = snapshotFor("client-claude");
    const codexDefaults = applyDefaults(codex, codexSnapshot);
    const claudeDefaults = applyDefaults(claude, claudeSnapshot);
    // Launch defaults are pending here. Production tail coalescing reuses the
    // captured ID, so only its immutable generation can preserve this choice.
    const codexNewer = enqueueEffort("client-codex", "reasoning_effort", "max");
    expect(codexNewer.intentId).toBe(codexCaptured.intentId);
    expect(codexNewer.generation).toBe(codexCaptured.generation + 1);
    const [codexResult, claudeResult] = await Promise.all([codexDefaults, claudeDefaults]);

    const publicationOrder: string[] = [];
    let sawSettlement = false;
    let sawMaterialization = false;
    let sawBinding = false;
    const unsubscribeIntent = useSessionIntentStore.subscribe((state) => {
      if (
        !sawSettlement
        && state.entriesById["claude-old"]?.status === "stale"
        && state.entriesById["claude-latest"]?.status === "reconciled"
      ) {
        sawSettlement = true;
        publicationOrder.push("settled");
      }
      if (
        !sawBinding
        && state.entriesById["claude-latest"]?.materializedSessionId === "runtime-claude"
      ) {
        sawBinding = true;
        publicationOrder.push("bound");
      }
    });
    const unsubscribeDirectory = useSessionDirectoryStore.subscribe((state) => {
      if (
        !sawMaterialization
        && state.entriesById["client-claude"]?.materializedSessionId === "runtime-claude"
      ) {
        sawMaterialization = true;
        publicationOrder.push("materialized");
      }
    });

    const versionBeforeClaudePublication = useSessionIntentStore.getState().dispatchVersion;
    publishCreation("client-claude", "workspace-1", claudeResult, claudeSnapshot);
    expect(useSessionIntentStore.getState().dispatchVersion)
      .toBe(versionBeforeClaudePublication + 2);
    publishCreation("client-codex", "workspace-1", codexResult, codexSnapshot);
    unsubscribeIntent();
    unsubscribeDirectory();

    expect(publicationOrder).toEqual(["settled", "materialized", "bound"]);
    expect(codex.requests).toEqual([
      { configId: "reasoning_effort", value: "high" },
    ]);
    expect(claude.requests).toEqual([
      { configId: "effort", value: "high" },
    ]);
    expect(useSessionIntentStore.getState().entriesById).toMatchObject({
      "claude-old": { status: "stale", rawConfigId: "effort" },
      "claude-latest": { status: "reconciled", rawConfigId: "effort" },
    });
    expect(useSessionIntentStore.getState().entriesById[codexCaptured.intentId])
      .toMatchObject({ generation: codexNewer.generation, materializedSessionId: "runtime-codex",
        rawConfigId: "reasoning_effort", status: "queued", value: "max" });

    const intentState = useSessionIntentStore.getState();
    const codexNext = selectNextDispatchableSessionIntent(intentState, "client-codex");
    expect(codexNext).toMatchObject({
      intentId: codexCaptured.intentId,
      controlKey: "effort",
      rawConfigId: "reasoning_effort",
      value: "max",
    });
    expect(selectNextDispatchableSessionIntent(intentState, "client-claude")).toBeNull();

    const liveMutation = vi.fn().mockResolvedValue(
      configResponse(codex.sessionWithValue("max")),
    );
    const onFailure = vi.fn();
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-codex",
    });
    await dispatchConfigIntent(
      codexNext as Extract<typeof codexNext, { kind: "update_config" }>,
      dispatchDeps(liveMutation, onFailure),
    );

    expect(liveMutation).toHaveBeenCalledTimes(1);
    expect(liveMutation).toHaveBeenCalledWith(expect.objectContaining({
      request: { configId: "reasoning_effort", value: "max" },
    }));
    expect(onFailure).not.toHaveBeenCalled();
  });
  it("retires an unsupported creation intent without a request or failure consequence", async () => {
    const fixture = strictConfigFixture({
      agentKind: "codex",
      applyState: "applied",
      currentValue: "high",
      exposeControl: false,
      modelId: "gpt-5.5",
      rawConfigId: "reasoning_effort",
      sessionId: "runtime-unsupported",
      values: ["high", "max"],
    });
    putProjectedRecord("client-unsupported", "workspace-1", "codex", "gpt-5.5");
    useSessionIntentStore.getState().enqueueConfig({
      intentId: "unsupported-effort",
      clientSessionId: "client-unsupported",
      workspaceId: "workspace-1",
      configId: null,
      controlKey: "effort",
      value: "max",
    });
    useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-after-unsupported",
      clientSessionId: "client-unsupported",
      workspaceId: "workspace-1",
      text: "Continue",
      blocks: [{ type: "text", text: "Continue" }],
    });
    const snapshot = snapshotFor("client-unsupported");
    const result = await applyDefaults(fixture, snapshot);

    publishCreation("client-unsupported", "workspace-1", result, snapshot);

    expect(fixture.requests).toEqual([]);
    expect(useSessionIntentStore.getState().entriesById["unsupported-effort"])
      .toMatchObject({ status: "stale", rawConfigId: null });
    expect(selectNextDispatchableSessionIntent(
      useSessionIntentStore.getState(),
      "client-unsupported",
    )).toMatchObject({ intentId: "prompt-after-unsupported" });
  });
  it("fails only the latest applicable creation intent when authority stays unchanged", async () => {
    const fixture = strictConfigFixture({
      agentKind: "codex",
      applyState: "applied",
      confirmApply: false,
      currentValue: "high",
      modelId: "gpt-5.5",
      rawConfigId: "reasoning_effort",
      sessionId: "runtime-unconfirmed",
      values: ["high", "max", "xhigh"],
    });
    putProjectedRecord("client-unconfirmed", "workspace-1", "codex", "gpt-5.5");
    enqueueEffort("client-unconfirmed", "reasoning_effort", "xhigh", "unconfirmed-old");
    enqueueEffort("client-unconfirmed", "reasoning_effort", "max", "unconfirmed-latest");
    const snapshot = snapshotFor("client-unconfirmed");
    const result = await applyDefaults(fixture, snapshot);

    publishCreation("client-unconfirmed", "workspace-1", result, snapshot);

    expect(fixture.requests).toEqual([
      { configId: "reasoning_effort", value: "max" },
    ]);
    expect(useSessionIntentStore.getState().entriesById).toMatchObject({
      "unconfirmed-old": { status: "stale" },
      "unconfirmed-latest": { status: "failed" },
    });
  });
  it("authoritatively classifies mapped launch intents before adoption binding", async () => {
    const fixture = strictConfigFixture({
      agentKind: "codex",
      applyState: "applied",
      currentValue: "high",
      modelId: "gpt-5.5",
      rawConfigId: "reasoning_effort",
      sessionId: "runtime-adopted",
      values: ["high", "max"],
    });
    putProjectedRecord("client-adopted", "workspace-1", "codex", "gpt-5.5");
    enqueueEffort("client-adopted", "catalog_reasoning_effort", "ultra", "adopted-unsupported");
    enqueueEffort("client-adopted", "catalog_reasoning_effort", "max", "adopted-supported");
    let classifiedBeforeBinding = false;
    const unsubscribe = useSessionIntentStore.subscribe((state) => {
      classifiedBeforeBinding ||=
        state.entriesById["adopted-unsupported"]?.status === "stale"
        && state.entriesById["adopted-supported"]?.rawConfigId === "reasoning_effort"
        && state.entriesById["adopted-supported"]?.materializedSessionId === null;
    });

    materializeExistingSession({
      existingProjectedRecord: null,
      existingSession: fixture.sessionWithValue("high"),
      fallbackModelId: "gpt-5.5",
      pendingSessionId: "client-adopted",
      resolvedModeId: null,
      upsertWorkspaceSessionRecord: vi.fn(),
      workspaceId: "workspace-1",
    });
    unsubscribe();

    expect(classifiedBeforeBinding).toBe(true);
    expect(useSessionIntentStore.getState().entriesById).toMatchObject({
      "adopted-supported": {
        status: "queued",
        rawConfigId: "reasoning_effort",
        materializedSessionId: "runtime-adopted",
      },
      "adopted-unsupported": {
        status: "stale",
        rawConfigId: "reasoning_effort",
        materializedSessionId: "runtime-adopted",
      },
    });
    const next = selectNextDispatchableSessionIntent(
      useSessionIntentStore.getState(),
      "client-adopted",
    );
    expect(next).toMatchObject({
      intentId: "adopted-supported",
      controlKey: "effort",
      rawConfigId: "reasoning_effort",
    });

    const liveMutation = vi.fn().mockResolvedValue(
      configResponse(fixture.sessionWithValue("max")),
    );
    const onFailure = vi.fn();
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-adopted",
    });
    await dispatchConfigIntent(
      next as Extract<typeof next, { kind: "update_config" }>,
      dispatchDeps(liveMutation, onFailure),
    );

    expect(liveMutation).toHaveBeenCalledTimes(1);
    expect(liveMutation).toHaveBeenCalledWith(expect.objectContaining({
      request: { configId: "reasoning_effort", value: "max" },
    }));
    expect(onFailure).not.toHaveBeenCalled();
  });
});
type ConfigSnapshot = ReturnType<typeof snapshotPreMaterializationConfigIntents>;

interface StrictConfigFixture {
  agentKind: string;
  client: AnyHarnessClient;
  initialValue: string;
  modelId: string;
  requests: Array<{ configId: string; value: string }>;
  sessionWithValue: (value: string) => Session;
}

/**
 * This narrow network double preserves the production config-intent lifecycle:
 * semantic `effort` remains distinct from the harness raw ID; tail-coalesced
 * choices reuse an ID only with a new generation; exact lookup, settable and
 * stay ordered; a queued response is not authoritative until a later config
 * read; and an applied response is confirmed only by authoritative state.
 * It deliberately defines no semantic-key alias.
 */
function strictConfigFixture(input: {
  agentKind: string;
  applyState: "applied" | "queued";
  confirmApply?: boolean;
  currentValue: string;
  exposeControl?: boolean;
  modelId: string;
  rawConfigId: string;
  sessionId: string;
  values: string[];
}): StrictConfigFixture {
  const requests: Array<{ configId: string; value: string }> = [];
  let currentValue = input.currentValue;
  let queuedValue: string | null = null;
  const exposeControl = input.exposeControl !== false;
  const confirmApply = input.confirmApply !== false;

  const sessionWithValue = (value: string): Session => session({
    agentKind: input.agentKind,
    liveConfig: liveConfig({
      currentValue: value,
      exposeControl,
      rawConfigId: input.rawConfigId,
      values: input.values,
    }),
    modelId: input.modelId,
    sessionId: input.sessionId,
  });
  const client = {
    sessions: {
      setConfigOption: vi.fn(async (sessionId: string, request: {
        configId: string;
        value: string;
      }) => {
        if (sessionId !== input.sessionId || request.configId !== input.rawConfigId) {
          throw new AnyHarnessError({
            type: "urn:proliferate:anyharness:problem:config-option-not-exposed",
            title: "Config option not exposed",
            status: 422,
            detail: `Config option '${request.configId}' is not exposed by the active session.`,
          });
        }
        if (!exposeControl || !input.values.includes(request.value)) {
          throw new AnyHarnessError({
            type: "urn:proliferate:anyharness:problem:config-value-unsupported",
            title: "Config value unsupported",
            status: 422,
            detail: `Config value '${request.value}' is not supported.`,
          });
        }
        requests.push(request);
        if (input.applyState === "queued") {
          queuedValue = request.value;
        } else if (confirmApply) {
          currentValue = request.value;
        }
        const responseSession = sessionWithValue(currentValue);
        return {
          applyState: input.applyState,
          session: responseSession,
          liveConfig: responseSession.liveConfig,
        };
      }),
      getLiveConfig: vi.fn(async () => {
        if (queuedValue !== null && confirmApply) {
          currentValue = queuedValue;
          queuedValue = null;
        }
        return { liveConfig: sessionWithValue(currentValue).liveConfig };
      }),
    },
  } as unknown as AnyHarnessClient;

  return {
    agentKind: input.agentKind,
    client,
    initialValue: input.currentValue,
    modelId: input.modelId,
    requests,
    sessionWithValue,
  };
}

function snapshotFor(clientSessionId: string): ConfigSnapshot {
  return snapshotPreMaterializationConfigIntents(
    sessionIntentsForSession(useSessionIntentStore.getState(), clientSessionId),
  );
}

async function applyDefaults(
  fixture: StrictConfigFixture,
  snapshot: ConfigSnapshot,
) {
  return applySessionLaunchDefaults({
    client: fixture.client,
    session: fixture.sessionWithValue(fixture.initialValue),
    agentKind: fixture.agentKind,
    modelRegistries: [registry(fixture.agentKind, fixture.modelId)],
    defaultLiveSessionControlValuesByAgentKind: {
      [fixture.agentKind]: configValuesFromIntentSnapshot(snapshot),
    },
  });
}

function publishCreation(
  clientSessionId: string,
  workspaceId: string,
  result: Awaited<ReturnType<typeof applySessionLaunchDefaults>>,
  snapshot: ConfigSnapshot,
): void {
  const liveConfigSnapshot = result.liveConfig ?? result.session.liveConfig ?? null;
  publishCreatedSessionMaterialization({
    agentKind: result.session.agentKind,
    configIntentSettlement: planCreationConfigIntentSettlement({
      snapshot,
      liveConfig: liveConfigSnapshot,
    }),
    fallbackModeId: null,
    fallbackModelId: result.session.modelId ?? "model",
    pendingSessionId: clientSessionId,
    record: {
      ...createEmptySessionRecord(clientSessionId, result.session.agentKind, {
        workspaceId,
        materializedSessionId: result.session.id,
        modelId: result.session.modelId,
        requestedModelId: result.session.requestedModelId,
        liveConfig: liveConfigSnapshot,
        sessionRelationship: { kind: "root" },
      }),
      status: "idle",
      transcriptHydrated: true,
    },
    session: result.session,
    trackProductEvent: vi.fn(),
    upsertWorkspaceSessionRecord: vi.fn(),
    workspaceId,
    workspaceKind: "local",
  });
}

function putProjectedRecord(
  clientSessionId: string,
  workspaceId: string,
  agentKind: string,
  modelId: string,
): void {
  putSessionRecord({
    ...createEmptySessionRecord(clientSessionId, agentKind, {
      workspaceId,
      materializedSessionId: null,
      modelId,
      requestedModelId: modelId,
      sessionRelationship: { kind: "root" },
    }),
    status: "starting",
    transcriptHydrated: true,
  });
}

function enqueueEffort(
  clientSessionId: string,
  rawConfigId: string,
  value: string,
  intentId?: string,
) {
  return useSessionIntentStore.getState().enqueueConfig({
    ...(intentId ? { intentId } : {}),
    clientSessionId,
    workspaceId: "workspace-1",
    configId: rawConfigId,
    controlKey: "effort",
    value,
  });
}

function registry(agentKind: string, modelId: string): SessionConfigModelRegistry {
  return {
    kind: agentKind,
    displayName: agentKind,
    defaultModelId: modelId,
    models: [{
      id: modelId,
      displayName: modelId,
      isDefault: true,
      status: "active",
      sessionDefaultControls: [{
        key: "effort",
        label: "Effort",
        values: ["low", "medium", "high", "max", "xhigh", "ultra"].map(
          (value) => ({ value, label: value, isDefault: value === "high" }),
        ),
      }],
    }],
  };
}

function session(input: {
  agentKind: string;
  liveConfig: SessionLiveConfigSnapshot;
  modelId: string;
  sessionId: string;
}): Session {
  return {
    id: input.sessionId,
    workspaceId: "workspace-1",
    agentKind: input.agentKind,
    modelId: input.modelId,
    requestedModelId: input.modelId,
    modeId: null,
    requestedModeId: null,
    status: "idle",
    title: null,
    createdAt: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    liveConfig: input.liveConfig,
    actionCapabilities: { fork: false, targetedFork: false },
  };
}

function liveConfig(input: {
  currentValue: string;
  exposeControl: boolean;
  rawConfigId: string;
  values: string[];
}): SessionLiveConfigSnapshot {
  const effort: NormalizedSessionControl | null = input.exposeControl
    ? {
        key: "effort",
        rawConfigId: input.rawConfigId,
        label: "Effort",
        currentValue: input.currentValue,
        settable: true,
        values: input.values.map((value) => ({ value, label: value })),
      }
    : null;
  return {
    sourceSeq: 1,
    rawConfigOptions: effort
      ? [{
          id: input.rawConfigId,
          name: "Effort",
          type: "select",
          currentValue: input.currentValue,
          options: [],
        }]
      : [],
    normalizedControls: {
      model: null,
      collaborationMode: null,
      mode: null,
      reasoning: null,
      effort,
      fastMode: null,
      extras: [],
    },
    updatedAt: "2026-08-15T00:00:00Z",
  };
}

function configResponse(session: Session): SetSessionConfigOptionResponse {
  return {
    applyState: "applied",
    session,
    liveConfig: session.liveConfig,
  };
}

function dispatchDeps(
  mutateAsync: ReturnType<typeof vi.fn>,
  onFailure: ReturnType<typeof vi.fn>,
): ConfigIntentDispatchDeps {
  return {
    cloudClient: null,
    getWorkspaceSurface: vi.fn(() => "standard"),
    setSessionConfigOptionMutation: {
      mutateAsync,
    } as unknown as ConfigIntentDispatchDeps["setSessionConfigOptionMutation"],
    upsertWorkspaceSessionRecord: vi.fn(),
    onFailure,
  };
}
