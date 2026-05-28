import { useEffect, useMemo, useState } from "react";
import {
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudRepoBranches,
  useCloudRepoConfigs,
  useCloudTargets,
  useAgentAuthCredentials,
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
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-model/chats/cloud/harness-availability";

import {
  buildMobileRepoOptions,
  buildMobileBranchOptions,
  buildMobileRuntimeOptions,
} from "../../../lib/domain/home/mobile-home-launch";

export function useMobileHomeLaunchModel() {
  const [repoId, setRepoId] = useState("");
  const [baseBranchByRepoId, setBaseBranchByRepoId] = useState<Record<string, string>>({});
  const [runtimeId, setRuntimeId] = useState("cloud");
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const repoConfigs = useCloudRepoConfigs();
  const targets = useCloudTargets();
  const agentAuthCredentials = useAgentAuthCredentials();
  const liveTargetId = runtimeId === "cloud" ? null : runtimeId;
  const targetLive = useTargetLive(liveTargetId, { enabled: Boolean(liveTargetId) });
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
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
  const repoBranches = useCloudRepoBranches(
    selectedRepo?.gitOwner,
    selectedRepo?.gitRepoName,
    Boolean(selectedRepo),
  );
  const selectedBaseBranchOverride = selectedRepo ? baseBranchByRepoId[selectedRepo.id] ?? null : null;
  const branchOptions = useMemo(
    () => buildMobileBranchOptions({
      branches: repoBranches.data?.branches,
      defaultBranch: repoBranches.data?.defaultBranch,
      selectedBranch: selectedBaseBranchOverride,
    }),
    [repoBranches.data?.branches, repoBranches.data?.defaultBranch, selectedBaseBranchOverride],
  );
  const selectedBaseBranch =
    selectedBaseBranchOverride
    ?? repoBranches.data?.defaultBranch
    ?? branchOptions[0]
    ?? null;
  const selectedRuntime =
    runtimeOptions.find((runtime) => runtime.id === runtimeId) ?? runtimeOptions[0] ?? null;
  const agentGateway = cloudCapabilities.data?.agentGateway;
  const readySyncedAgentKinds = useMemo(
    () => readySyncedCloudAgentKinds(agentAuthCredentials.data),
    [agentAuthCredentials.data],
  );
  const readySyncedAgentKindsKey = readySyncedAgentKinds.join("\0");
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog.data?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const harnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog.data?.agents.map((agent) => agent.kind),
    readyAgentKinds: selectedRuntime?.kind === "target"
      ? agentCatalog.data?.agents.map((agent) => agent.kind)
      : readySyncedAgentKinds,
    agentGateway: selectedRuntime?.kind === "target" ? null : agentGateway,
    assumeFallbackAgentKindsLaunchable: selectedRuntime?.kind === "target",
  }), [
    agentCatalog.data,
    readySyncedAgentKindsKey,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayManagedCreditKindsKey,
    catalogAgentKindsKey,
    selectedRuntime?.kind,
  ]);
  const launchableAgentKinds = harnessAvailability.launchableAgentKinds;
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds,
      selection: launchSelection,
    }),
    [agentCatalog.data, launchSelection, launchableAgentKinds],
  );
  const launchComposerControls = useMemo(
    () => buildCloudLaunchComposerControls({
      catalog: agentCatalog.data,
      launchableAgentKinds,
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
    [agentCatalog.data, launchableAgentKinds, resolvedLaunchSelection],
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
    agentAuthCredentials,
    cloudCapabilities,
    harnessAvailability,
    launchableAgentKinds,
    launchComposerControls,
    branchOptions,
    repoBranches,
    repoConfigs,
    repoId,
    repoOptions,
    resolvedLaunchSelection,
    runtimeId,
    runtimeOptions,
    selectedRepo,
    selectedBaseBranch,
    selectedRuntime,
    setBaseBranch: (branch: string) => {
      if (!selectedRepo) {
        return;
      }
      setBaseBranchByRepoId((current) => ({
        ...current,
        [selectedRepo.id]: branch,
      }));
    },
    setRepoId,
    setRuntimeId,
    targetLive,
  };
}
