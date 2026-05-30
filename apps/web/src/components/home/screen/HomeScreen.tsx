import { Bot, Cloud, GitBranch, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type CloudTargetSummary,
  type CloudWorkspaceSummary,
  listCloudWorkspaces,
  type CloudWorkspaceDetail,
  type CreateCloudWorkspaceRequest,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudClient,
  useCloudRepoBranches,
  useCloudRepoConfigs,
  useCreateCloudWorkspace,
  useCloudTargets,
  useVisibleCloudWorkspaces,
  useLaunchCloudWorkspaceOnTarget,
  useTargetLive,
  useAgentAuthCredentials,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudLaunchComposerControls,
  buildLaunchSessionConfigUpdates,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  buildRecentWorkItems,
  type RecentWorkItemView,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";
import {
  formatGitRepoId,
  normalizeGitRepoId,
  parseGitRepoId,
} from "@proliferate/product-domain/repos/repo-id";

import type {
  NewChatPickerId,
  NoticeView,
  PickerView,
} from "@proliferate/product-ui/new-chat/NewChatSurface";
import type { CloudChatComposerControlView } from "@proliferate/product-ui/chat/CloudChatComposer";
import { NewChatSurface } from "@proliferate/product-ui/new-chat/NewChatSurface";
import type { CloudChatTranscriptRowView } from "@proliferate/product-ui/chat/CloudChatTranscript";
import { AddCloudEnvironmentDialogController } from "@proliferate/product-surfaces/settings/CloudEnvironmentsSettingsSurface";

import { webEnv } from "../../../config/env";
import { routes } from "../../../config/routes";
import { ensurePersonalAgentAuthLaunchReady } from "../../../lib/access/cloud/agent-auth-launch-readiness";
import { isRecoverableCloudDispatchError } from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import { savePendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import { saveWebCloudPromptIntents } from "../../../stores/cloud/web-cloud-chat-state-store";

const HOME_PLACEHOLDER = "Describe a quick remote task...";
const HOME_RECENT_LIMIT = 6;

interface RepoOption {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  description: string;
}

interface HomePendingPrompt {
  id: string;
  text: string;
  status: "creating" | "failed";
  detail?: string | null;
}

type RuntimeOption =
  | {
    id: "cloud";
    kind: "cloud";
    label: string;
    description: string;
    online: true;
    targetId: null;
  }
  | {
    id: string;
    kind: "target";
    label: string;
    description: string;
    online: boolean;
    targetId: string;
  };

export function HomeScreen() {
  const navigate = useNavigate();
  const client = useCloudClient();
  const submitInFlightRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [repoId, setRepoId] = useState(() =>
    readLastRepoId() ?? normalizeGitRepoId(webEnv.defaultCloudRepo) ?? ""
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
  const createWorkspace = useCreateCloudWorkspace();
  const launchOnTarget = useLaunchCloudWorkspaceOnTarget();
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
  const canStartCloudHarness = launchableAgentKinds.length > 0;
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

  function handlePickerSelect(picker: NewChatPickerId, itemId: string) {
    if (picker === "target") {
      setRepoId(itemId);
      writeLastRepoId(itemId);
      return;
    }
  }

  function handleAction(actionId: string) {
    if (actionId === "add-repo") {
      setAddRepoOpen(true);
    }
  }

  function handleRepoSelected(nextRepoId: string) {
    setRepoId(nextRepoId);
    writeLastRepoId(nextRepoId);
    void repoConfigs.refetch();
  }

  async function handleSubmit() {
    const text = draft.trim();
    if (!text || !selectedRepo || submitInFlightRef.current) return;
    if (!selectedRuntime) {
      setSubmitError("Select a runtime before sending.");
      return;
    }
    if (selectedRuntime.kind === "target" && !selectedRuntime.online) {
      setSubmitError(`${selectedRuntime.label} is offline.`);
      return;
    }
    if (!canStartCloudHarness) {
      setSubmitError(
        harnessAvailability.message ?? "No cloud agent is ready to start this workspace.",
      );
      return;
    }

    submitInFlightRef.current = true;
    setSubmitError(null);
    const pendingPrompt = {
      id: `web-home:${Date.now().toString(36)}`,
      text,
      status: "creating" as const,
    };
    setPendingPrompt(pendingPrompt);
    setDraft("");
    try {
      await waitForNextPaint();
      const sessionConfigUpdates = buildLaunchSessionConfigUpdates({
        catalog: agentCatalog.data,
        launchableAgentKinds,
        selection: resolvedLaunchSelection,
      });
      const workspacePendingPrompt = {
        id: pendingPrompt.id,
        text,
        agentKind: resolvedLaunchSelection.agentKind,
        modelId: resolvedLaunchSelection.modelId,
        modeId: resolvedLaunchSelection.modeId,
        sessionConfigUpdates,
        createdAt: Date.now(),
      };
      if (selectedRuntime.kind === "target") {
        const result = await launchOnTarget.mutateAsync({
          targetId: selectedRuntime.targetId,
          gitProvider: "github",
          gitOwner: selectedRepo.gitOwner,
          gitRepoName: selectedRepo.gitRepoName,
          baseBranch: selectedBaseBranch,
          branchName: buildBranchName(text),
          displayName: buildWorkspaceDisplayName(text),
          prompt: text,
          promptId: pendingPrompt.id,
          agentKind: resolvedLaunchSelection.agentKind,
          modelId: resolvedLaunchSelection.modelId,
          modeId: resolvedLaunchSelection.modeId,
          sessionConfigUpdates,
          source: "web",
        });
        saveWebCloudPromptIntents(result.workspace.id, [
          {
            id: pendingPrompt.id,
            workspaceId: result.workspace.id,
            sessionId: result.sessionId,
            text,
            baseTranscriptSeq: 0,
            status: "queued",
            commandId: result.sendCommandId,
            createdAt: Date.now(),
          },
        ]);
        navigate(routes.chat(result.workspace.id, result.sessionId));
        return;
      }
      await ensurePersonalAgentAuthLaunchReady({
        client,
        agentKind: normalizeAgentAuthAgentKind(resolvedLaunchSelection.agentKind),
        modelId: resolvedLaunchSelection.modelId,
      });
      const workspaceRequest: CreateCloudWorkspaceRequest = {
        gitProvider: "github",
        gitOwner: selectedRepo.gitOwner,
        gitRepoName: selectedRepo.gitRepoName,
        baseBranch: selectedBaseBranch,
        branchName: buildBranchName(text),
        displayName: buildWorkspaceDisplayName(text),
        ownerScope: "personal",
        requiredAgentKind: resolvedLaunchSelection.agentKind,
        source: "web",
      };
      const workspace = await createCloudWorkspaceWithTransientRecovery({
        client,
        request: workspaceRequest,
        createWorkspace: createWorkspace.mutateAsync,
      });
      savePendingHomePrompt(workspace.id, workspacePendingPrompt);
      navigate(routes.workspace(workspace.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create workspace.";
      setSubmitError(message);
      setPendingPrompt({
        ...pendingPrompt,
        status: "failed",
        detail: message,
      });
    } finally {
      submitInFlightRef.current = false;
    }
  }

  const submitting = createWorkspace.isPending
    || launchOnTarget.isPending
    || submitInFlightRef.current;
  const transcriptRows = useMemo(
    () => buildPendingPromptRows(pendingPrompt),
    [pendingPrompt],
  );
  const repoNotice = selectedRepo
    ? null
    : {
      id: "repo-required",
      tone: "warning" as const,
      text: "Select a GitHub repository before sending.",
    };
  const errorNotice: NoticeView | null = submitError
    ? {
      id: "submit-error",
      tone: "error",
      text: submitError,
    }
    : null;
  const harnessNotice: NoticeView | null = !canStartCloudHarness && harnessAvailability.message
    ? {
      id: "harness-required",
      tone: "warning",
      text: harnessAvailability.message,
    }
    : null;
  const runtimeNotice: NoticeView | null = selectedRuntime?.kind === "target" && !selectedRuntime.online
    ? {
      id: "runtime-offline",
      tone: "warning",
      text: `${selectedRuntime.label} is offline.`,
    }
    : null;
  if (errorNotice && pendingPrompt?.status === "failed") {
    errorNotice.action = {
      label: "Retry",
      onClick: () => {
        setDraft(pendingPrompt.text);
        setPendingPrompt(null);
        setSubmitError(null);
      },
    };
  }
  const notices: NoticeView[] = [];
  if (repoNotice) notices.push(repoNotice);
  if (runtimeNotice) notices.push(runtimeNotice);
  if (harnessNotice) notices.push(harnessNotice);
  if (errorNotice) notices.push(errorNotice);
  const recentItems = useMemo(
    () => homeRecentItems(visibleWorkspaces.data ?? []),
    [visibleWorkspaces.data],
  );

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

  return (
    <div className="h-full" data-telemetry-block>
      <NewChatSurface
        heading="What should we run?"
        draft={draft}
        placeholder={HOME_PLACEHOLDER}
        canSubmit={
          Boolean(draft.trim())
          && Boolean(selectedRepo)
          && Boolean(selectedRuntime)
          && selectedRuntimeReady
          && canStartCloudHarness
          && !submitting
        }
        submitting={submitting}
        target={buildTargetPicker(repoId, repoOptions, repoConfigs.isLoading)}
        model={buildModelPicker(resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID)}
        mode={buildModePicker()}
        extraComposerControls={composerControls}
        notices={notices}
        transcriptRows={transcriptRows}
        recentItems={recentItems}
        recentLoading={visibleWorkspaces.isLoading}
        commandMessage={
          pendingPrompt?.status === "creating"
            ? selectedRuntime?.kind === "target"
              ? "Dispatching to Desktop. The prompt will send as soon as the session is ready."
              : "Creating a cloud workspace. The prompt will send as soon as the workspace is ready."
            : null
        }
        actions={[
          {
            id: "add-repo",
            label: "Add cloud environment",
            icon: <Plus size={13} />,
          },
        ]}
        onDraftChange={setDraft}
        onSubmit={() => void handleSubmit()}
        onPickerSelect={handlePickerSelect}
        onAction={handleAction}
        onRecentSelect={handleRecentSelect}
      />
      <AddCloudEnvironmentDialogController
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        onEnvironmentAdded={handleRepoSelected}
      />
    </div>
  );
}

function homeRecentItems(workspaces: readonly CloudWorkspaceSummary[]): RecentWorkItemView[] {
  const items = buildRecentWorkItems(workspaces, { nowMs: Date.now() });
  const activeItems = items.filter((item) => item.statusIndicator.kind !== "idle");
  return (activeItems.length >= 3 ? activeItems : items).slice(0, HOME_RECENT_LIMIT);
}

function buildPendingPromptRows(
  pendingPrompt: HomePendingPrompt | null,
): CloudChatTranscriptRowView[] {
  if (!pendingPrompt) {
    return [];
  }
  const isCreating = pendingPrompt.status === "creating";
  return [
    {
      id: `${pendingPrompt.id}:user`,
      kind: "user",
      body: pendingPrompt.text,
      status: isCreating ? "Loading" : "Failed",
    },
    isCreating
      ? {
        id: `${pendingPrompt.id}:assistant`,
        kind: "assistant",
        title: "Workspace setup",
        body: null,
        detail: "Preparing workspace.",
        streaming: true,
      }
      : {
        id: `${pendingPrompt.id}:error`,
        kind: "error",
        title: "Workspace creation failed",
        body: pendingPrompt.detail ?? "The prompt was not sent.",
        status: "Failed",
      },
  ];
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

async function createCloudWorkspaceWithTransientRecovery(args: {
  client: ProliferateCloudClient;
  request: CreateCloudWorkspaceRequest;
  createWorkspace: (request: CreateCloudWorkspaceRequest) => Promise<CloudWorkspaceDetail>;
}): Promise<Pick<CloudWorkspaceDetail, "id">> {
  let lastError: unknown = null;
  for (const delayMs of [0, 750, 1500]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      return await args.createWorkspace(args.request);
    } catch (error) {
      lastError = error;
      const recovered = await recoverCreatedWorkspaceByBranch(args).catch(() => null);
      if (recovered) {
        return recovered;
      }
      if (!isRecoverableCloudDispatchError(error) && !isDuplicateBranchError(error)) {
        throw error;
      }
    }
  }
  const recovered = await recoverCreatedWorkspaceByBranch(args).catch(() => null);
  if (recovered) {
    return recovered;
  }
  throw lastError instanceof Error ? lastError : new Error("Could not create workspace.");
}

async function recoverCreatedWorkspaceByBranch(args: {
  client: ProliferateCloudClient;
  request: CreateCloudWorkspaceRequest;
}): Promise<Pick<CloudWorkspaceDetail, "id"> | null> {
  const workspaces = await listCloudWorkspaces(
    undefined,
    { ownerScope: args.request.ownerScope ?? "personal", scope: "my" },
    args.client,
  );
  return workspaces.find((workspace) =>
    workspace.repo.owner === args.request.gitOwner
    && workspace.repo.name === args.request.gitRepoName
    && workspace.repo.branch === args.request.branchName
  ) ?? null;
}

function isDuplicateBranchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bcloud_branch_already_exists\b|\bbranch\b.*\balready exists\b/i.test(message);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function normalizeAgentAuthAgentKind(agentKind: string) {
  return agentKind === "claude"
    || agentKind === "codex"
    || agentKind === "opencode"
    || agentKind === "gemini"
    ? agentKind
    : null;
}

function buildTargetPicker(
  selectedId: string,
  repoOptions: RepoOption[],
  loading: boolean,
): PickerView {
  return {
    label: loading ? "Loading repos" : "Repository",
    icon: <GitBranch size={13} />,
    disabled: loading || repoOptions.length === 0,
    groups: [
      {
        id: "repositories",
        label: "GitHub repositories",
        items: repoOptions.map((repo) => ({
          id: repo.id,
          label: repo.label,
          description: repo.description,
          icon: <GitBranch size={13} />,
          selected: repo.id === selectedId,
        })),
      },
    ],
  };
}

function buildRuntimeControl(input: {
  runtimeOptions: readonly RuntimeOption[];
  loading: boolean;
  selectedRuntime: RuntimeOption | null;
  onSelect: (runtimeId: string) => void;
}): CloudChatComposerControlView {
  const options = input.loading && input.runtimeOptions.length <= 1
    ? [
      {
        id: "__loading__",
        label: "Loading runtimes...",
        disabled: true,
        selected: true,
      },
    ]
    : input.runtimeOptions.map((runtime) => ({
      id: runtime.id,
      label: runtime.label,
      description: runtime.description,
      selected: runtime.id === input.selectedRuntime?.id,
      disabled: runtime.kind === "target" && !runtime.online,
    }));

  return {
    id: "new-chat-runtime",
    key: "runtime",
    label: "Runtime",
    icon: "build",
    placement: "leading",
    disabled: input.loading && input.runtimeOptions.length <= 1,
    groups: [
      {
        id: "runtimes",
        label: "Run destination",
        options,
      },
    ],
    onSelect: (optionId) => {
      if (!optionId.startsWith("__")) {
        input.onSelect(optionId);
      }
    },
  };
}

function buildModelPicker(selectedId: string): PickerView {
  const models = [
    { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced cloud work" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Fast lighter tasks" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Coding-heavy work" },
  ];
  return {
    label: "Model",
    icon: <Bot size={13} />,
    groups: [
      {
        id: "models",
        items: models.map((model) => ({
          ...model,
          selected: model.id === selectedId,
        })),
      },
    ],
  };
}

function buildModePicker(): PickerView {
  return {
    label: "Mode",
    icon: <Cloud size={13} />,
    disabled: true,
    groups: [
      {
        id: "modes",
        items: [
          {
            id: "cloud-task",
            label: "Cloud task",
            description: "Create a workspace and send this prompt",
            icon: <Cloud size={13} />,
            selected: true,
          },
        ],
      },
    ],
  };
}

function buildRuntimeOptions(
  targets: readonly CloudTargetSummary[] | undefined,
): RuntimeOption[] {
  return [
    {
      id: "cloud",
      kind: "cloud",
      label: "Cloud sandbox",
      description: "Run in managed cloud compute",
      online: true,
      targetId: null,
    },
    ...((targets ?? [])
      .filter((target) => target.kind === "desktop_dispatch")
      .map((target): RuntimeOption => ({
        id: target.id,
        kind: "target",
        label: targetLabel(target),
        description: target.status === "online"
          ? "Dispatch to this connected Desktop"
          : target.statusDetail?.statusDetail ?? "Desktop target is offline",
        online: target.status === "online",
        targetId: target.id,
      }))),
  ];
}

function buildRepoOptions(
  configs: readonly {
    gitOwner: string;
    gitRepoName: string;
    configured: boolean;
  }[],
  defaultRepo: string | null,
): RepoOption[] {
  const options = new Map<string, RepoOption>();
  for (const config of configs) {
    if (!config.configured) {
      continue;
    }
    const id = formatGitRepoId({
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
    });
    options.set(id, {
      id,
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      label: id,
      description: "Configured cloud repo",
    });
  }

  const normalizedDefault = normalizeGitRepoId(defaultRepo);
  if (normalizedDefault && !options.has(normalizedDefault)) {
    const parsed = parseGitRepoId(normalizedDefault);
    if (parsed) {
      options.set(normalizedDefault, {
        id: normalizedDefault,
        gitOwner: parsed.gitOwner,
        gitRepoName: parsed.gitRepoName,
        label: normalizedDefault,
        description: "Development default",
      });
    }
  }
  return Array.from(options.values());
}

function targetLabel(target: CloudTargetSummary): string {
  const displayName = target.displayName?.trim();
  return displayName || "Desktop Mac";
}

function buildBranchOptions(input: {
  branches?: readonly string[] | null;
  defaultBranch?: string | null;
  selectedBranch?: string | null;
}): string[] {
  const options: string[] = [];
  addUniqueBranch(options, input.defaultBranch);
  addUniqueBranch(options, input.selectedBranch);
  for (const branch of input.branches ?? []) {
    addUniqueBranch(options, branch);
  }
  return options;
}

function buildBranchControl(input: {
  branchOptions: readonly string[];
  loading: boolean;
  selectedBranch: string | null;
  disabled: boolean;
  onSelect: (branch: string) => void;
}): CloudChatComposerControlView {
  const options = input.loading && input.branchOptions.length === 0
    ? [{
      id: "__loading__",
      label: "Loading branches...",
      disabled: true,
      selected: true,
    }]
    : input.branchOptions.length === 0
      ? [{
        id: "__empty__",
        label: "No branches found",
        disabled: true,
        selected: true,
      }]
      : input.branchOptions.map((branch) => ({
        id: branch,
        label: branch,
        selected: branch === input.selectedBranch,
      }));

  return {
    id: "new-chat-base-branch",
    key: "branch",
    label: "Base branch",
    icon: "branch",
    placement: "leading",
    disabled: input.disabled || (input.loading && input.branchOptions.length === 0),
    groups: [
      {
        id: "branches",
        label: "GitHub branches",
        options,
      },
    ],
    onSelect: (optionId) => {
      if (!optionId.startsWith("__")) {
        input.onSelect(optionId);
      }
    },
  };
}

function addUniqueBranch(options: string[], branch: string | null | undefined): void {
  const trimmed = branch?.trim();
  if (trimmed && !options.includes(trimmed)) {
    options.push(trimmed);
  }
}

function buildBranchName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 42)
    .replace(/-+$/gu, "") || "web-task";
  return `proliferate/${slug}-${Date.now().toString(36)}`;
}

function buildWorkspaceDisplayName(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/u)[0]?.trim() || "Web task";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

function readLastRepoId(): string | null {
  try {
    return normalizeGitRepoId(window.localStorage.getItem("proliferate.web.homeRepo"));
  } catch {
    return null;
  }
}

function writeLastRepoId(repo: string): void {
  try {
    window.localStorage.setItem("proliferate.web.homeRepo", repo);
  } catch {
    // Ignore storage failures; the picker state remains in memory.
  }
}
