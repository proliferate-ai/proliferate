import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAgentAuthCredentials,
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudRepoBranches,
  useCloudRepoConfigs,
  useCloudTargets,
  useTargetLive,
  useVisibleCloudWorkspaces,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudLaunchComposerControls,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import { normalizeGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";
import type { RecentWorkItemView } from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import type { NewChatPickerId } from "@proliferate/product-ui/new-chat/NewChatSurface";

import { webEnv } from "../../../config/env";
import { routes } from "../../../config/routes";
import { readLastHomeRepoId, writeLastHomeRepoId } from "../../../lib/access/browser/home-repo-selection-storage";
import {
  buildBranchOptions,
  buildRepoOptions,
  buildRuntimeOptions,
  homeRecentItems,
} from "../../../lib/domain/home/cloud-home-launch-model";
import {
  buildPendingPromptRows,
  type HomePendingPrompt,
} from "../../../lib/domain/home/cloud-home-pending-prompt";
import {
  buildBranchControl,
  buildHomeNotices,
  buildRuntimeControl,
} from "./build-web-home-composer-controls";
import { useWebHomeSubmitWorkflow } from "../workflows/use-web-home-submit-workflow";

export function useWebHomeScreen() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [repoId, setRepoId] = useState(() =>
    readLastHomeRepoId() ?? normalizeGitRepoId(webEnv.defaultCloudRepo) ?? ""
  );
  const [baseBranchByRepoId, setBaseBranchByRepoId] = useState<Record<string, string>>({});
  const [runtimeId, setRuntimeId] = useState("cloud");
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<HomePendingPrompt | null>(null);
  const repoConfigs = useCloudRepoConfigs();
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();
  const visibleWorkspaces = useVisibleCloudWorkspaces();
  const targets = useCloudTargets();
  const liveTargetId = runtimeId === "cloud" ? null : runtimeId;
  const targetLive = useTargetLive(liveTargetId, { enabled: Boolean(liveTargetId) });
  const repoOptions = useMemo(
    () => buildRepoOptions(repoConfigs.data?.configs ?? [], webEnv.defaultCloudRepo),
    [repoConfigs.data?.configs],
  );
  const selectedRepo = useMemo(
    () => repoOptions.find((repo) => repo.id === repoId) ?? repoOptions[0] ?? null,
    [repoId, repoOptions],
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
    () => buildRuntimeOptions(liveTargets),
    [liveTargets],
  );
  const selectedRuntime = useMemo(
    () => runtimeOptions.find((runtime) => runtime.id === runtimeId) ?? runtimeOptions[0] ?? null,
    [runtimeId, runtimeOptions],
  );
  const repoBranches = useCloudRepoBranches(
    selectedRepo?.gitOwner,
    selectedRepo?.gitRepoName,
    Boolean(selectedRepo),
  );
  const selectedBaseBranchOverride = selectedRepo ? baseBranchByRepoId[selectedRepo.id] ?? null : null;
  const branchOptions = useMemo(
    () => buildBranchOptions({
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
  const selectedRuntimeReady = selectedRuntime?.kind !== "target" || selectedRuntime.online;
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
  const composerControls = useMemo(
    () => [
      buildBranchControl({
        branchOptions,
        loading: repoBranches.isLoading,
        selectedBranch: selectedBaseBranch,
        disabled: !selectedRepo,
        onSelect: (branch) => {
          if (!selectedRepo) {
            return;
          }
          setBaseBranchByRepoId((current) => ({
            ...current,
            [selectedRepo.id]: branch,
          }));
        },
      }),
      buildRuntimeControl({
        runtimeOptions,
        loading: targets.isLoading,
        selectedRuntime,
        onSelect: setRuntimeId,
      }),
      ...launchComposerControls,
    ],
    [
      branchOptions,
      launchComposerControls,
      repoBranches.isLoading,
      runtimeOptions,
      selectedBaseBranch,
      selectedRepo,
      selectedRuntime,
      targets.isLoading,
    ],
  );

  useEffect(() => {
    if (!repoId && !selectedRepo && repoOptions[0]) {
      setRepoId(repoOptions[0].id);
    }
  }, [repoId, repoOptions, selectedRepo]);

  useEffect(() => {
    if (!runtimeOptions.some((runtime) => runtime.id === runtimeId)) {
      setRuntimeId("cloud");
    }
  }, [runtimeId, runtimeOptions]);

  const canStartCloudHarness = launchableAgentKinds.length > 0;
  const submitWorkflow = useWebHomeSubmitWorkflow({
    draft,
    selectedRepo,
    selectedRuntime,
    selectedBaseBranch,
    canStartCloudHarness,
    harnessMessage: harnessAvailability.message,
    agentCatalog: agentCatalog.data,
    launchableAgentKinds,
    resolvedLaunchSelection,
    setDraft,
    setSubmitError,
    setPendingPrompt,
  });
  const transcriptRows = useMemo(
    () => buildPendingPromptRows(pendingPrompt),
    [pendingPrompt],
  );
  const notices = buildHomeNotices({
    selectedRepo,
    selectedRuntime,
    canStartCloudHarness,
    harnessMessage: harnessAvailability.message,
    submitError,
    pendingPrompt,
    onRetryPendingPrompt: () => {
      if (!pendingPrompt) {
        return;
      }
      setDraft(pendingPrompt.text);
      setPendingPrompt(null);
      setSubmitError(null);
    },
  });
  const recentItems = useMemo(
    () => homeRecentItems(visibleWorkspaces.data ?? []),
    [visibleWorkspaces.data],
  );

  function handlePickerSelect(picker: NewChatPickerId, itemId: string) {
    if (picker === "target") {
      setRepoId(itemId);
      writeLastHomeRepoId(itemId);
    }
  }

  function handleAction(actionId: string) {
    if (actionId === "add-repo") {
      setAddRepoOpen(true);
    }
  }

  function handleRepoSelected(nextRepoId: string) {
    setRepoId(nextRepoId);
    writeLastHomeRepoId(nextRepoId);
    void repoConfigs.refetch();
  }

  function handleRecentSelect(item: RecentWorkItemView) {
    switch (item.openTarget.kind) {
      case "session":
        navigate(routes.chat(item.openTarget.workspaceId, item.openTarget.sessionId));
        return;
      case "workspace":
        navigate(routes.workspace(item.openTarget.workspaceId));
        return;
      case "pending-session":
        navigate(routes.workspace(item.openTarget.workspaceId));
        return;
    }
  }

  return {
    draft,
    repoId,
    repoOptions,
    repoLoading: repoConfigs.isLoading,
    resolvedModelId: resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    addRepoOpen,
    composerControls,
    notices,
    transcriptRows,
    recentItems,
    recentLoading: visibleWorkspaces.isLoading,
    canSubmit: Boolean(draft.trim())
      && Boolean(selectedRepo)
      && Boolean(selectedRuntime)
      && selectedRuntimeReady
      && canStartCloudHarness
      && !submitWorkflow.submitting,
    submitting: submitWorkflow.submitting,
    commandMessage: pendingPrompt?.status === "creating"
      ? selectedRuntime?.kind === "target"
        ? "Dispatching to Desktop. The prompt will send as soon as the session is ready."
        : "Creating a cloud workspace. The prompt will send as soon as the workspace is ready."
      : null,
    setDraft,
    setAddRepoOpen,
    handleSubmit: submitWorkflow.handleSubmit,
    handlePickerSelect,
    handleAction,
    handleRecentSelect,
    handleRepoSelected,
  };
}
