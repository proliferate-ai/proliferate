import { useEffect, useMemo, useState } from "react";
import {
  useCloudAgentCatalog,
  useCloudRepoConfigs,
  useCloudTargets,
  useTargetLive,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudLaunchComposerControls,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-model/chats/cloud/composer-controls";

import {
  buildMobileRepoOptions,
  buildMobileRuntimeOptions,
} from "../../../lib/domain/home/mobile-home-launch";

export function useMobileHomeLaunchModel() {
  const [repoId, setRepoId] = useState("");
  const [runtimeId, setRuntimeId] = useState("cloud");
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const repoConfigs = useCloudRepoConfigs();
  const targets = useCloudTargets();
  const liveTargetId = runtimeId === "cloud" ? null : runtimeId;
  const targetLive = useTargetLive(liveTargetId, { enabled: Boolean(liveTargetId) });
  const agentCatalog = useCloudAgentCatalog();
  const repoOptions = useMemo(
    () => buildMobileRepoOptions(repoConfigs.data?.configs ?? []),
    [repoConfigs.data?.configs],
  );
  const liveTargets = useMemo(() => {
    const liveTarget = targetLive.snapshot?.target;
    if (!liveTarget) {
      return targets.data;
    }
    const baseTargets = targets.data ?? [];
    if (!baseTargets.some((target) => target.id === liveTarget.id)) {
      return [...baseTargets, liveTarget];
    }
    return baseTargets.map((target) =>
      target.id === liveTarget.id ? { ...target, ...liveTarget } : target
    );
  }, [targetLive.snapshot?.target, targets.data]);
  const runtimeOptions = useMemo(
    () => buildMobileRuntimeOptions(liveTargets),
    [liveTargets],
  );
  const selectedRepo = repoOptions.find((repo) => repo.id === repoId) ?? repoOptions[0] ?? null;
  const selectedRuntime =
    runtimeOptions.find((runtime) => runtime.id === runtimeId) ?? runtimeOptions[0] ?? null;
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      selection: launchSelection,
    }),
    [agentCatalog.data, launchSelection],
  );
  const launchComposerControls = useMemo(
    () => buildCloudLaunchComposerControls({
      catalog: agentCatalog.data,
      selection: resolvedLaunchSelection,
      onAgentModelSelect: (agentKind, modelId) => {
        setLaunchSelection((current) => ({
          agentKind,
          modelId,
          modeId: current.agentKind === agentKind ? current.modeId : null,
          controlValues: current.agentKind === agentKind ? current.controlValues : {},
        }));
      },
      onControlSelect: ({ controlKey, value }) => {
        setLaunchSelection((current) => {
          if (controlKey === "mode") {
            return { ...current, modeId: value };
          }
          return {
            ...current,
            controlValues: {
              ...current.controlValues,
              [controlKey]: value,
            },
          };
        });
      },
    }),
    [agentCatalog.data, resolvedLaunchSelection],
  );

  useEffect(() => {
    if (!repoId && repoOptions[0]) {
      setRepoId(repoOptions[0].id);
    }
  }, [repoId, repoOptions]);

  useEffect(() => {
    if (!runtimeOptions.some((runtime) => runtime.id === runtimeId)) {
      setRuntimeId("cloud");
    }
  }, [runtimeId, runtimeOptions]);

  return {
    agentCatalog,
    launchComposerControls,
    repoConfigs,
    repoId,
    repoOptions,
    resolvedLaunchSelection,
    runtimeId,
    runtimeOptions,
    selectedRepo,
    selectedRuntime,
    setRepoId,
    setRuntimeId,
    targetLive,
  };
}
