import { Bot, Cloud, GitBranch, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listCloudWorkspaces,
  type CloudWorkspaceDetail,
  type CreateCloudWorkspaceRequest,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudClient,
  useCloudRepoConfigs,
  useCreateCloudWorkspace,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudLaunchComposerControls,
  buildLaunchSessionConfigUpdates,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-model/chats/cloud/composer-controls";
import {
  resolveCloudHarnessAvailability,
} from "@proliferate/product-model/chats/cloud/harness-availability";
import {
  formatGitRepoId,
  normalizeGitRepoId,
  parseGitRepoId,
} from "@proliferate/product-model/repos/repo-id";

import type {
  NewChatPickerId,
  NoticeView,
  PickerView,
} from "@proliferate/product-ui/new-chat/NewChatSurface";
import { NewChatSurface } from "@proliferate/product-ui/new-chat/NewChatSurface";
import type { CloudChatTranscriptRowView } from "@proliferate/product-ui/chat/CloudChatTranscript";

import { webEnv } from "../../../config/env";
import { routes } from "../../../config/routes";
import { ensurePersonalAgentAuthLaunchReady } from "../../../lib/access/cloud/agent-auth-launch-readiness";
import { isRecoverableCloudDispatchError } from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import { savePendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import { AddCloudEnvironmentDialogController } from "../../environments/screen/AddCloudEnvironmentDialogController";

const HOME_PLACEHOLDER = "Describe a quick remote task...";

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

export function HomeScreen() {
  const navigate = useNavigate();
  const client = useCloudClient();
  const submitInFlightRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [repoId, setRepoId] = useState(() =>
    readLastRepoId() ?? normalizeGitRepoId(webEnv.defaultCloudRepo) ?? ""
  );
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
  const createWorkspace = useCreateCloudWorkspace();
  const repoOptions = useMemo(
    () => buildRepoOptions(repoConfigs.data?.configs ?? [], webEnv.defaultCloudRepo),
    [repoConfigs.data?.configs],
  );
  const selectedRepo = useMemo(
    () => repoOptions.find((repo) => repo.id === repoId) ?? repoOptions[0] ?? null,
    [repoId, repoOptions],
  );
  const agentGateway = cloudCapabilities.data?.agentGateway;
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog.data?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const harnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog.data?.agents.map((agent) => agent.kind),
    agentGateway,
  }), [
    agentCatalog.data,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayManagedCreditKindsKey,
    catalogAgentKindsKey,
  ]);
  const launchableAgentKinds = harnessAvailability.launchableAgentKinds;
  const canStartCloudHarness = launchableAgentKinds.length > 0;
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
    if (!repoId && !selectedRepo && repoOptions[0]) {
      setRepoId(repoOptions[0].id);
    }
  }, [repoId, repoOptions, selectedRepo]);

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
      const workspacePendingPrompt = {
        id: pendingPrompt.id,
        text,
        agentKind: resolvedLaunchSelection.agentKind,
        modelId: resolvedLaunchSelection.modelId,
        modeId: resolvedLaunchSelection.modeId,
        sessionConfigUpdates: buildLaunchSessionConfigUpdates({
          catalog: agentCatalog.data,
          launchableAgentKinds,
          selection: resolvedLaunchSelection,
        }),
        createdAt: Date.now(),
      };
      await ensurePersonalAgentAuthLaunchReady({
        client,
        agentKind: normalizeAgentAuthAgentKind(resolvedLaunchSelection.agentKind),
        modelId: resolvedLaunchSelection.modelId,
      });
      const workspaceRequest: CreateCloudWorkspaceRequest = {
        gitProvider: "github",
        gitOwner: selectedRepo.gitOwner,
        gitRepoName: selectedRepo.gitRepoName,
        branchName: buildBranchName(text),
        displayName: buildWorkspaceDisplayName(text),
        ownerScope: "personal",
        requiredAgentKind: resolvedLaunchSelection.agentKind,
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
  if (harnessNotice) notices.push(harnessNotice);
  if (errorNotice) notices.push(errorNotice);

  return (
    <div className="h-full" data-telemetry-block>
      <NewChatSurface
        heading="What should we run?"
        draft={draft}
        placeholder={HOME_PLACEHOLDER}
        canSubmit={Boolean(draft.trim()) && Boolean(selectedRepo) && canStartCloudHarness && !submitting}
        submitting={submitting}
        target={buildTargetPicker(repoId, repoOptions, repoConfigs.isLoading)}
        model={buildModelPicker(resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID)}
        mode={buildModePicker()}
        extraComposerControls={launchComposerControls}
        notices={notices}
        transcriptRows={transcriptRows}
        commandMessage={
          pendingPrompt?.status === "creating"
            ? "Creating a cloud workspace. The prompt will send as soon as the workspace is ready."
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
      />
      <AddCloudEnvironmentDialogController
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        onEnvironmentAdded={handleRepoSelected}
      />
    </div>
  );
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
      status: isCreating ? "Creating workspace" : "Failed",
      streaming: isCreating,
    },
    isCreating
      ? {
        id: `${pendingPrompt.id}:assistant`,
        kind: "assistant",
        title: "Cloud setup",
        body: "Preparing the workspace and queuing this prompt.",
        status: "Waiting",
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
