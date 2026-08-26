import { useEffect, useMemo, useState } from "react";
import {
  useCloudRepoBranches,
  useRepositories,
} from "@proliferate/cloud-sdk-react";
import type {
  CloudHarnessLaunchOptionsResponse,
} from "@proliferate/product-client/internal/domain/chats/cloud/launch-options-model";
import {
  buildCloudLaunchComposerControls,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-client/internal/domain/chats/cloud/composer-controls";
import {
  resolveCloudHarnessAvailability,
} from "@proliferate/product-client/internal/domain/chats/cloud/harness-availability";

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
    modelId: null,
    controlValues: {},
  });
  const repoConfigs = useRepositories();
  // The cloud sandbox stack is deleted: there is no copied launch-options
  // observation to read, so the composer renders without model options.
  const launchOptions = {
    data: undefined as CloudHarnessLaunchOptionsResponse | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: false,
  };
  const configuredCloudRepos = useMemo(
    () => (repoConfigs.data?.repositories ?? []).flatMap((repo) => {
      const cloudEnvironment = repo.environments.find((environment) =>
        environment.kind === "cloud"
      );
      if (!cloudEnvironment) {
        return [];
      }
      return [{
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
      }];
    }),
    [repoConfigs.data?.repositories],
  );
  const repoOptions = useMemo(
    () => buildMobileRepoOptions(configuredCloudRepos),
    [configuredCloudRepos],
  );
  const runtimeOptions = useMemo(
    () => buildMobileRuntimeOptions(),
    [],
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
  const harnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: launchOptions.data?.options ? [launchOptions.data.harnessKind] : [],
  }), [
    launchOptions.data,
  ]);
  const launchableAgentKinds = harnessAvailability.launchableAgentKinds;
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      launchOptions: launchOptions.data,
      selection: launchSelection,
    }),
    [launchOptions.data, launchSelection],
  );
  const launchComposerControls = useMemo(
    () => buildCloudLaunchComposerControls({
      launchOptions: launchOptions.data,
      selection: resolvedLaunchSelection,
      onAgentModelSelect: (agentKind, modelId) => {
        setLaunchSelection((current) => ({
          agentKind,
          modelId,
          controlValues: current.agentKind === agentKind ? current.controlValues : {},
        }));
      },
      onControlSelect: ({ controlKey, value }) => {
        setLaunchSelection((current) => {
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
    [launchOptions.data, resolvedLaunchSelection],
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
    launchOptions,
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
  };
}
