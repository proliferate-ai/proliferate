import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";

export interface ChatModelVisibilityOverride {
  shownModelIds: string[];
  hiddenModelIds: string[];
}

export type ChatModelVisibilityOverridesByAgentKind = Record<
  string,
  ChatModelVisibilityOverride
>;

type ModelVisibilityAgent = Pick<
  DesktopAgentLaunchAgent,
  "modelDisplayPolicy"
> & {
  models?: readonly DesktopAgentLaunchModel[];
};

const EMPTY_OVERRIDE: ChatModelVisibilityOverride = {
  shownModelIds: [],
  hiddenModelIds: [],
};

function sanitizeModelIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.flatMap((item) => {
    const modelId = typeof item === "string" ? item.trim() : "";
    return modelId ? [modelId] : [];
  }))];
}

export function sanitizeChatModelVisibilityOverridesByAgentKind(
  value: unknown,
): ChatModelVisibilityOverridesByAgentKind {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, rawOverride]) => {
      const trimmedAgentKind = agentKind.trim();
      if (!trimmedAgentKind || !rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) {
        return [];
      }

      const record = rawOverride as Record<string, unknown>;
      const override = compactOverride({
        shownModelIds: sanitizeModelIdList(record.shownModelIds),
        hiddenModelIds: sanitizeModelIdList(record.hiddenModelIds),
      });
      return override ? [[trimmedAgentKind, override]] : [];
    }),
  );
}

export function resolveChatModelVisibilityOverride(
  overrides: ChatModelVisibilityOverridesByAgentKind | null | undefined,
  agentKind: string,
): ChatModelVisibilityOverride {
  return overrides?.[agentKind] ?? EMPTY_OVERRIDE;
}

export function isDefaultVisibleChatModel(
  agent: ModelVisibilityAgent,
  model: Pick<DesktopAgentLaunchModel, "id" | "isDefault" | "tags">,
): boolean {
  const policy = agent.modelDisplayPolicy ?? null;
  if (!policy?.allowUserVisibleModelSelection) {
    return true;
  }

  return policy.defaultVisibleModelIds.includes(model.id)
    || model.isDefault
    || model.tags.includes("recommended");
}

export function isDefaultVisibleChatModelId(args: {
  agent: ModelVisibilityAgent;
  modelId: string;
  catalogModel?: Pick<DesktopAgentLaunchModel, "id" | "isDefault" | "tags"> | null;
}): boolean {
  if (args.catalogModel) {
    return isDefaultVisibleChatModel(args.agent, args.catalogModel);
  }

  const policy = args.agent.modelDisplayPolicy ?? null;
  if (!policy?.allowUserVisibleModelSelection) {
    return true;
  }

  return policy.defaultVisibleModelIds.includes(args.modelId);
}

export function isChatModelIdVisible(args: {
  agent: ModelVisibilityAgent;
  agentKind: string;
  modelId: string;
  catalogModel?: Pick<DesktopAgentLaunchModel, "id" | "isDefault" | "tags"> | null;
  overrides: ChatModelVisibilityOverridesByAgentKind | null | undefined;
  forceVisible?: boolean;
}): boolean {
  if (args.forceVisible) {
    return true;
  }

  const policy = args.agent.modelDisplayPolicy ?? null;
  if (!policy?.allowUserVisibleModelSelection) {
    return true;
  }

  const override = resolveChatModelVisibilityOverride(args.overrides, args.agentKind);
  if (override.hiddenModelIds.includes(args.modelId)) {
    return false;
  }
  if (override.shownModelIds.includes(args.modelId)) {
    return true;
  }

  return isDefaultVisibleChatModelId(args);
}

export function withToggledChatModelVisibilityOverride(
  current: ChatModelVisibilityOverridesByAgentKind,
  agentKind: string,
  modelId: string,
  visible: boolean,
  defaultVisible: boolean,
): ChatModelVisibilityOverridesByAgentKind {
  const override = resolveChatModelVisibilityOverride(current, agentKind);
  const shown = new Set(override.shownModelIds);
  const hidden = new Set(override.hiddenModelIds);

  if (visible) {
    hidden.delete(modelId);
    if (defaultVisible) {
      shown.delete(modelId);
    } else {
      shown.add(modelId);
    }
  } else {
    shown.delete(modelId);
    if (defaultVisible) {
      hidden.add(modelId);
    } else {
      hidden.delete(modelId);
    }
  }

  return withCompactedOverride(current, agentKind, {
    shownModelIds: [...shown],
    hiddenModelIds: [...hidden],
  });
}

export function withoutChatModelVisibilityOverride(
  current: ChatModelVisibilityOverridesByAgentKind,
  agentKind: string,
): ChatModelVisibilityOverridesByAgentKind {
  const { [agentKind]: _removed, ...next } = current;
  return next;
}

function withCompactedOverride(
  current: ChatModelVisibilityOverridesByAgentKind,
  agentKind: string,
  override: ChatModelVisibilityOverride,
): ChatModelVisibilityOverridesByAgentKind {
  const compacted = compactOverride(override);
  if (!compacted) {
    return withoutChatModelVisibilityOverride(current, agentKind);
  }

  return {
    ...current,
    [agentKind]: compacted,
  };
}

function compactOverride(
  override: ChatModelVisibilityOverride,
): ChatModelVisibilityOverride | null {
  const hidden = [...new Set(override.hiddenModelIds)].filter((id) => !override.shownModelIds.includes(id));
  const shown = [...new Set(override.shownModelIds)];
  if (shown.length === 0 && hidden.length === 0) {
    return null;
  }

  return {
    shownModelIds: shown,
    hiddenModelIds: hidden,
  };
}
