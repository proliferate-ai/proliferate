import type {
  AnyHarnessClient,
  ModelRegistry,
  ModelRegistryModel,
  NormalizedSessionControl,
  Session,
  SessionDefaultControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type {
  DefaultLiveSessionControlKey,
  DefaultLiveSessionControlValuesByAgentKind,
} from "@/lib/domain/preferences/user-preferences";

const LIVE_CONFIG_AVAILABILITY_ATTEMPTS = 3;
const QUEUED_APPLY_ATTEMPTS = 10;
const POLL_DELAY_MS = 200;

const CONTROL_APPLY_ORDER: DefaultLiveSessionControlKey[] = [
  "reasoning",
  "effort",
  "fast_mode",
];

type NormalizedControlSlot = "reasoning" | "effort" | "fastMode";

const NORMALIZED_CONTROL_SLOT_BY_KEY: Record<
  DefaultLiveSessionControlKey,
  NormalizedControlSlot
> = {
  reasoning: "reasoning",
  effort: "effort",
  fast_mode: "fastMode",
};

interface ApplySessionLaunchDefaultsInput {
  client: AnyHarnessClient;
  session: Session;
  agentKind: string;
  modelRegistries: readonly ModelRegistry[];
  defaultLiveSessionControlValuesByAgentKind:
    DefaultLiveSessionControlValuesByAgentKind;
}

interface ApplySessionLaunchDefaultsResult {
  session: Session;
  liveConfig: SessionLiveConfigSnapshot | null;
}

interface ConfirmedLaunchDefaultApplyResult {
  session: Session;
  liveConfig: SessionLiveConfigSnapshot;
}

export async function applySessionLaunchDefaults({
  client,
  session,
  agentKind,
  modelRegistries,
  defaultLiveSessionControlValuesByAgentKind,
}: ApplySessionLaunchDefaultsInput): Promise<ApplySessionLaunchDefaultsResult> {
  const registry = modelRegistries.find((candidate) => candidate.kind === agentKind);
  if (!registry) {
    return {
      session,
      liveConfig: session.liveConfig ?? null,
    };
  }

  let workingSession = session;
  let workingLiveConfig = await resolveInitialLiveConfig(client, workingSession);
  if (!workingLiveConfig) {
    return {
      session: workingSession,
      liveConfig: null,
    };
  }

  const model = resolveSessionModel(registry, workingSession, workingLiveConfig);
  const metadataByKey = buildDefaultControlMetadataByKey(
    model?.sessionDefaultControls ?? [],
  );
  if (metadataByKey.size === 0) {
    return {
      session: attachLiveConfig(workingSession, workingLiveConfig),
      liveConfig: workingLiveConfig,
    };
  }

  const defaults =
    defaultLiveSessionControlValuesByAgentKind[agentKind] ?? {};

  for (const controlKey of CONTROL_APPLY_ORDER) {
    const defaultValue = defaults[controlKey]?.trim();
    if (!defaultValue) {
      continue;
    }

    const metadata = metadataByKey.get(controlKey);
    if (!metadata || !metadata.values.some((value) => value.value === defaultValue)) {
      continue;
    }

    const liveControl = getLiveControl(workingLiveConfig, controlKey);
    if (
      !liveControl
      || !liveControl.settable
      || !liveControl.values.some((value) => value.value === defaultValue)
      || liveControl.currentValue === defaultValue
    ) {
      continue;
    }

    try {
      const response = await client.sessions.setConfigOption(workingSession.id, {
        configId: liveControl.rawConfigId,
        value: defaultValue,
      });

      const confirmed = response.applyState === "applied"
        ? confirmAppliedResponse(
          response.session,
          response.liveConfig ?? response.session.liveConfig ?? null,
          controlKey,
          defaultValue,
        )
        : await pollUntilLiveConfigReflectsValue(
          client,
          response.session,
          controlKey,
          defaultValue,
        );

      if (!confirmed) {
        continue;
      }

      workingSession = confirmed.session;
      workingLiveConfig = confirmed.liveConfig;
    } catch {
      continue;
    }
  }

  return {
    session: attachLiveConfig(workingSession, workingLiveConfig),
    liveConfig: workingLiveConfig,
  };
}

function buildDefaultControlMetadataByKey(
  controls: readonly SessionDefaultControl[],
): Map<DefaultLiveSessionControlKey, SessionDefaultControl> {
  const metadataByKey = new Map<
    DefaultLiveSessionControlKey,
    SessionDefaultControl
  >();

  for (const control of controls) {
    if (isDefaultLiveSessionControlKey(control.key)) {
      metadataByKey.set(control.key, control);
    }
  }

  return metadataByKey;
}

function isDefaultLiveSessionControlKey(
  value: string,
): value is DefaultLiveSessionControlKey {
  return value === "reasoning" || value === "effort" || value === "fast_mode";
}

function getLiveControl(
  liveConfig: SessionLiveConfigSnapshot,
  controlKey: DefaultLiveSessionControlKey,
): NormalizedSessionControl | null {
  return liveConfig.normalizedControls[NORMALIZED_CONTROL_SLOT_BY_KEY[controlKey]]
    ?? null;
}

async function resolveInitialLiveConfig(
  client: AnyHarnessClient,
  session: Session,
): Promise<SessionLiveConfigSnapshot | null> {
  if (session.liveConfig) {
    return session.liveConfig;
  }

  for (let attempt = 0; attempt < LIVE_CONFIG_AVAILABILITY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await delay(POLL_DELAY_MS);
    }

    try {
      const response = await client.sessions.getLiveConfig(session.id);
      if (response.liveConfig) {
        return response.liveConfig;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function resolveSessionModel(
  registry: ModelRegistry,
  session: Session,
  liveConfig: SessionLiveConfigSnapshot,
): ModelRegistryModel | null {
  const candidates = [
    liveConfig.normalizedControls.model?.currentValue,
    session.modelId,
    session.requestedModelId,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const model = findModelByIdOrAlias(registry, candidate);
    if (model) {
      return model;
    }
  }

  return null;
}

function findModelByIdOrAlias(
  registry: ModelRegistry,
  idOrAlias: string,
): ModelRegistryModel | null {
  return registry.models.find((model) => model.id === idOrAlias)
    ?? registry.models.find((model) => (model.aliases ?? []).includes(idOrAlias))
    ?? null;
}

function confirmAppliedResponse(
  session: Session,
  liveConfig: SessionLiveConfigSnapshot | null,
  controlKey: DefaultLiveSessionControlKey,
  expectedValue: string,
): ConfirmedLaunchDefaultApplyResult | null {
  if (!liveConfigReflectsValue(liveConfig, controlKey, expectedValue)) {
    return null;
  }

  return {
    session: attachLiveConfig(session, liveConfig),
    liveConfig,
  };
}

async function pollUntilLiveConfigReflectsValue(
  client: AnyHarnessClient,
  session: Session,
  controlKey: DefaultLiveSessionControlKey,
  expectedValue: string,
): Promise<ConfirmedLaunchDefaultApplyResult | null> {
  for (let attempt = 0; attempt < QUEUED_APPLY_ATTEMPTS; attempt += 1) {
    await delay(POLL_DELAY_MS);

    try {
      const response = await client.sessions.getLiveConfig(session.id);
      const liveConfig = response.liveConfig ?? null;
      if (liveConfigReflectsValue(liveConfig, controlKey, expectedValue)) {
        return {
          session: attachLiveConfig(session, liveConfig),
          liveConfig,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function liveConfigReflectsValue(
  liveConfig: SessionLiveConfigSnapshot | null,
  controlKey: DefaultLiveSessionControlKey,
  expectedValue: string,
): liveConfig is SessionLiveConfigSnapshot {
  if (!liveConfig) {
    return false;
  }

  return getLiveControl(liveConfig, controlKey)?.currentValue === expectedValue;
}

function attachLiveConfig(
  session: Session,
  liveConfig: SessionLiveConfigSnapshot,
): Session {
  return {
    ...session,
    liveConfig,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
