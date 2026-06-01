import type { CloudChatComposerControlView } from "@proliferate/product-ui/chat/CloudChatComposer";
import type { NoticeView } from "@proliferate/product-ui/new-chat/NewChatSurface";

import type { RepoOption, RuntimeOption } from "../../../lib/domain/home/cloud-home-launch-model";
import type { HomePendingPrompt } from "../../../lib/domain/home/cloud-home-pending-prompt";

export function buildHomeNotices(input: {
  selectedRepo: RepoOption | null;
  selectedRuntime: RuntimeOption | null;
  canStartCloudHarness: boolean;
  harnessMessage: string | null | undefined;
  submitError: string | null;
  pendingPrompt: HomePendingPrompt | null;
  onRetryPendingPrompt: () => void;
}): NoticeView[] {
  const repoNotice = input.selectedRepo
    ? null
    : {
      id: "repo-required",
      tone: "warning" as const,
      text: "Select a GitHub repository before sending.",
    };
  const errorNotice: NoticeView | null = input.submitError
    ? {
      id: "submit-error",
      tone: "error",
      text: input.submitError,
    }
    : null;
  const harnessNotice: NoticeView | null = !input.canStartCloudHarness && input.harnessMessage
    ? {
      id: "harness-required",
      tone: "warning",
      text: input.harnessMessage,
    }
    : null;
  const runtimeNotice: NoticeView | null = input.selectedRuntime?.kind === "target" && !input.selectedRuntime.online
    ? {
      id: "runtime-offline",
      tone: "warning",
      text: `${input.selectedRuntime.label} is offline.`,
    }
    : null;
  if (errorNotice && input.pendingPrompt?.status === "failed") {
    errorNotice.action = {
      label: "Retry",
      onClick: input.onRetryPendingPrompt,
    };
  }
  return [
    repoNotice,
    runtimeNotice,
    harnessNotice,
    errorNotice,
  ].filter((notice): notice is NoticeView => Boolean(notice));
}

export function buildRuntimeControl(input: {
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

export function buildBranchControl(input: {
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
